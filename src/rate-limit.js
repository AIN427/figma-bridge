import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * A bare "429" cannot tell a per-minute limit that passes in seconds from a
 * seat quota that will not pass for weeks. Figma's headers can, so they travel
 * with the error and the last refusal is kept on disk — reading it later must
 * not cost another call against the same limit.
 */

export const RATE_LIMIT_FILE = path.join(import.meta.dirname, "..", ".cache", "rate-limit.json");

const SEATS = { low: "View/Collab seat", high: "Full/Dev seat" };

/** Picks the rate-limit headers off a 429. Only these — never the whole set. */
export function rateLimitFrom(headers, now = Date.now()) {
  const info = {};
  const retry = headers.get("retry-after");
  if (/^\d+$/.test(retry ?? "")) {
    info.retryAfterSec = Number(retry);
    info.retryAt = new Date(now + info.retryAfterSec * 1000).toISOString();
  }
  const fields = {
    planTier: "x-figma-plan-tier",
    limitType: "x-figma-rate-limit-type",
    upgradeLink: "x-figma-upgrade-link",
  };
  for (const [field, header] of Object.entries(fields)) {
    const value = headers.get(header);
    if (value) info[field] = value;
  }
  return info;
}

/** "3h 20m" rather than "12000s" — the number a person can act on. */
export function humanDuration(sec) {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec % 60}s`;
  return `${sec}s`;
}

/** Says only what Figma sent; an empty string when it sent nothing. */
export function describeRateLimit(info) {
  const parts = [];
  if (info.retryAfterSec !== undefined) {
    const human = humanDuration(info.retryAfterSec);
    const raw = info.retryAfterSec < 60 ? "" : `${info.retryAfterSec}s, `;
    parts.push(`retry after ${human} (${raw}at ${info.retryAt})`);
  }
  if (info.limitType) {
    const seat = SEATS[info.limitType];
    parts.push(`limit type ${info.limitType}${seat ? ` (${seat})` : ""}`);
  }
  if (info.planTier) parts.push(`plan ${info.planTier}`);
  if (info.upgradeLink) parts.push(`upgrade ${info.upgradeLink}`);
  return parts.join(" · ");
}

/** Seconds still to wait, 0 once the retry time has passed, null if unknown. */
export function waitLeftSec(record, now = Date.now()) {
  if (!record.retryAt) return null;
  return Math.max(0, Math.ceil((Date.parse(record.retryAt) - now) / 1000));
}

/** The stored refusal as text: when, on what, what Figma said, how long is left. */
export function rateLimitStatus(record, now = Date.now()) {
  const lines = [`last Figma rate-limit refusal: ${record.at}, GET ${record.endpoint}`];
  const said = describeRateLimit(record);
  lines.push(`  ${said || "Figma sent no retry time or limit type"}`);
  const left = waitLeftSec(record, now);
  if (left !== null) lines.push(`  ${left ? `${humanDuration(left)} left to wait` : "retry time has passed"}`);
  return lines.join("\n");
}

export async function saveRateLimit(record, file = RATE_LIMIT_FILE) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(record, null, 2), "utf8");
  } catch {
    // Recording a refusal must never become a failure of its own.
  }
}

export async function readRateLimit(file = RATE_LIMIT_FILE) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
