import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fullFile, shallow } from "./figma-api.js";

const ROOT = path.join(import.meta.dirname, "..");
export const CACHE_DIR = path.join(ROOT, ".cache");

// Parsed documents kept in memory so a 167MB file is not re-parsed per request.
// Two entries is plenty — work concentrates on one file at a time — and each
// one costs real heap, so this number is a memory decision, not a guess.
const MEMO_MAX = 2;
const memo = new Map();

// How long a memoized file is trusted before re-checking its version upstream.
// Design files change on human timescales; checking every minute only burns
// Figma's rate limit, which is shared across every call this token makes.
const FRESH_MS = Number(process.env.FIGMA_FRESH_MS ?? 10 * 60_000);

// Concurrent requests for the same uncached file must not each download it.
const inFlight = new Map();

const cacheFile = (key) => path.join(CACHE_DIR, `${key}.json`);

export const isCached = (key) => existsSync(cacheFile(key));

function remember(key, data) {
  memo.delete(key);
  memo.set(key, { data, checkedAt: Date.now() });
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
  return data;
}

/** Version check that never throws — a rate limit must not break a read. */
async function tryShallow(key) {
  try {
    return await shallow(key);
  } catch {
    return null;
  }
}

async function load(key, refresh) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = cacheFile(key);

  const hot = memo.get(key);
  if (!refresh && hot) {
    if (Date.now() - hot.checkedAt < FRESH_MS) return { ...hot.data, cached: "memory" };
    const head = await tryShallow(key);
    if (!head || head.version === hot.data.version) {
      hot.checkedAt = Date.now();
      return { ...hot.data, cached: head ? "memory" : "memory, version unverified" };
    }
  }

  if (!refresh && existsSync(file)) {
    const cached = JSON.parse(await readFile(file, "utf8"));
    const head = await tryShallow(key);
    if (!head || head.version === cached.version)
      return { ...remember(key, cached), cached: head ? "disk" : "disk, version unverified" };
  }

  try {
    const fresh = await fullFile(key);
    await writeFile(file, JSON.stringify(fresh), "utf8");
    return { ...remember(key, fresh), cached: false };
  } catch (err) {
    // Serving something stale beats serving nothing — but say so out loud.
    if (existsSync(file)) {
      const stale = JSON.parse(await readFile(file, "utf8"));
      return { ...remember(key, stale), cached: `STALE — refetch failed (${err.message})` };
    }
    throw err;
  }
}

/**
 * Full file JSON, cached on disk and memoized in memory. This cache is what
 * keeps token cost away from network cost: fetched once, sliced many times.
 *
 * Known limit: parsing a very large document blocks the event loop for a few
 * seconds, during which the server answers nobody. Acceptable for a local
 * single-user tool; it would need a worker thread to fix properly.
 */
export function getFile(key, { refresh = false } = {}) {
  const slot = `${key}|${refresh}`;
  const pending = inFlight.get(slot);
  if (pending) return pending;

  const run = load(key, refresh).finally(() => inFlight.delete(slot));
  inFlight.set(slot, run);
  return run;
}

// id -> node, built once per document and discarded with it. Keyed on the
// document object itself, so evicting a file from memo frees its index too.
const indexes = new WeakMap();

function buildIndex(node, into) {
  into.set(node.id, node);
  for (const child of node.children ?? []) buildIndex(child, into);
}

/** Lazily built id index. One walk per document instead of one per lookup. */
export function nodeIndex(document) {
  let index = indexes.get(document);
  if (!index) {
    index = new Map();
    buildIndex(document, index);
    indexes.set(document, index);
  }
  return index;
}

export const findNode = (document, id) => nodeIndex(document).get(id) ?? null;
