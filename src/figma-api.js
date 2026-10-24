import { BadRequest, FigmaError } from "./errors.js";
import { rateLimitFrom, saveRateLimit } from "./rate-limit.js";

const API = "https://api.figma.com/v1";

/** Nothing may hang forever: a stalled socket must fail, not wedge a request. */
const TIMEOUT_MS = Number(process.env.FIGMA_TIMEOUT_MS ?? 120_000);

function token() {
  const t = process.env.FIGMA_TOKEN;
  if (!t) throw new BadRequest("FIGMA_TOKEN is not set (see .env.example)", 500);
  return t;
}

/** GET against the Figma REST API, with auth, timeout and typed failures. */
export async function get(pathname) {
  let res;
  try {
    res = await fetch(API + pathname, {
      headers: { "X-Figma-Token": token() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError")
      throw new FigmaError(504, `no answer in ${TIMEOUT_MS / 1000}s`);
    throw new FigmaError(502, err.message);
  }
  if (!res.ok) {
    const err = await failure(res);
    if (err.rateLimit) {
      const at = new Date().toISOString();
      await saveRateLimit({ at, endpoint: pathname, body: err.body, ...err.rateLimit });
    }
    throw err;
  }
  return res.json();
}

/** A failed response as a FigmaError; on a 429 it keeps what Figma said about the limit. */
export async function failure(res) {
  const body = (await res.text()).slice(0, 400);
  return new FigmaError(res.status, body, res.status === 429 ? rateLimitFrom(res.headers) : undefined);
}

/** Downloads a rendered asset from the short-lived URL Figma hands back. */
export async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new FigmaError(res.status, "asset download failed");
  return Buffer.from(await res.arrayBuffer());
}

export const me = () => get("/me");

/**
 * Name and version without the document — the version check. Any read under
 * /files/:key, even ?depth=1, is Tier 1 at Figma: a monthly quota on View/Collab
 * seats. /meta is Tier 3 and needs the file_metadata:read scope.
 */
export const meta = async (key) => (await get(`/files/${key}/meta`)).file;

export const fullFile = (key) => get(`/files/${key}`);

/** Needs the folders:read scope. Drafts are invisible to both of these. */
export const teamProjects = (teamId) => get(`/teams/${teamId}/projects`);
export const projectFiles = (projectId) => get(`/projects/${projectId}/files`);

/** Pulls a file key out of any figma.com URL shape. */
export function keyFromUrl(input) {
  return input.match(/figma\.com\/(?:file|design|proto|board|slides)\/([0-9A-Za-z]+)/)?.[1] ?? null;
}

export const looksLikeKey = (input) => /^[0-9A-Za-z]{15,}$/.test(input);
