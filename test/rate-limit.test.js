import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { failure } from "../src/figma-api.js";
import {
  humanDuration,
  rateLimitStatus,
  readRateLimit,
  saveRateLimit,
  waitLeftSec,
} from "../src/rate-limit.js";

/** A Figma refusal built locally — nothing here spends real quota. */
const refusal = (status, headers = {}) =>
  new Response(JSON.stringify({ status, err: "Rate limit exceeded" }), { status, headers });

const FIGMA_HEADERS = {
  "retry-after": "3600",
  "x-figma-plan-tier": "starter",
  "x-figma-rate-limit-type": "low",
  "x-figma-upgrade-link": "https://www.figma.com/pricing",
};

test("a 429 carries the retry time and the kind of limit, in text and in data", async () => {
  const err = await failure(refusal(429, FIGMA_HEADERS));

  assert.equal(err.status, 429);
  assert.equal(err.upstream, true);
  assert.equal(err.rateLimit.retryAfterSec, 3600);
  assert.equal(err.rateLimit.limitType, "low");
  assert.equal(err.rateLimit.planTier, "starter");
  assert.equal(err.rateLimit.upgradeLink, "https://www.figma.com/pricing");
  assert.ok(err.rateLimit.retryAt, "absolute retry time is computed");

  assert.match(err.message, /retry after 1h 0m \(3600s, at /);
  assert.match(err.message, /limit type low \(View\/Collab seat\)/);
  assert.match(err.message, /plan starter/);
});

test("only the rate-limit headers are kept, nothing else from the response", async () => {
  const err = await failure(refusal(429, { ...FIGMA_HEADERS, "set-cookie": "session=secret" }));
  assert.deepEqual(Object.keys(err.rateLimit).sort(), [
    "limitType",
    "planTier",
    "retryAfterSec",
    "retryAt",
    "upgradeLink",
  ]);
  assert.ok(!err.message.includes("secret"));
});

test("a 429 without headers reads exactly as before", async () => {
  const err = await failure(refusal(429));
  assert.equal(err.message, 'Figma API 429: {"status":429,"err":"Rate limit exceeded"}');
  assert.deepEqual(err.rateLimit, {});
});

test("other errors are untouched", async () => {
  const err = await failure(refusal(404, FIGMA_HEADERS));
  assert.equal(err.rateLimit, undefined);
  assert.ok(!err.message.includes("retry after"));
});

test("durations read as a person would say them", () => {
  assert.equal(humanDuration(45), "45s");
  assert.equal(humanDuration(125), "2m 5s");
  assert.equal(humanDuration(3600), "1h 0m");
  assert.equal(humanDuration(2 * 86_400 + 3 * 3600), "2d 3h");
});

test("the last refusal survives on disk and reports how long is left", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "figma-bridge-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "rate-limit.json");

  assert.equal(await readRateLimit(file), null);

  const record = {
    at: "2026-10-01T20:10:00.000Z",
    endpoint: "/files/AAAAAAAAAAAAAAAA?depth=1",
    body: "Rate limit exceeded",
    retryAfterSec: 86_400,
    retryAt: "2026-10-02T20:10:00.000Z",
    limitType: "low",
  };
  await saveRateLimit(record, file);
  assert.deepEqual(await readRateLimit(file), record);

  const halfway = Date.parse("2026-10-02T08:10:00.000Z");
  assert.equal(waitLeftSec(record, halfway), 12 * 3600);
  assert.match(rateLimitStatus(record, halfway), /12h 0m left to wait/);

  const after = Date.parse("2026-10-03T00:00:00.000Z");
  assert.equal(waitLeftSec(record, after), 0);
  assert.match(rateLimitStatus(record, after), /retry time has passed/);
});

test("a stored refusal without details says so instead of guessing", () => {
  const status = rateLimitStatus({ at: "2026-10-01T20:10:00.000Z", endpoint: "/files/X" });
  assert.match(status, /Figma sent no retry time or limit type/);
  assert.ok(!status.includes("left to wait"));
});
