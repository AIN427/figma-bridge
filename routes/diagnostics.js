import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../src/cache.js";
import { me } from "../src/figma-api.js";
import { rateLimitStatus, readRateLimit, waitLeftSec } from "../src/rate-limit.js";
import { HELP } from "./help.js";

const LOG = path.join(CACHE_DIR, "access.log");

export const diagnostics = [
  {
    method: "GET",
    match: /^\/health$/,
    // Local only: never calls Figma, so it is safe to ask while rate-limited.
    handler: async () => {
      const tokenSet = Boolean(process.env.FIGMA_TOKEN);
      const port = Number(process.env.PORT ?? 3846);
      const last = await readRateLimit();
      const text = `ok — port ${port}, token ${tokenSet ? "set" : "MISSING"}`;
      return {
        text: last ? `${text}\n${rateLimitStatus(last)}` : text,
        data: {
          ok: true,
          port,
          token: tokenSet ? "set" : "missing",
          lastRateLimit: last && { ...last, waitLeftSec: waitLeftSec(last) },
        },
      };
    },
  },

  {
    method: "GET",
    match: /^\/(?:|help)$/,
    handler: () => HELP,
  },

  {
    method: "GET",
    match: /^\/me$/,
    handler: async () => {
      const u = await me();
      return {
        text: `${u.handle} <${u.email}>  id=${u.id}`,
        data: { handle: u.handle, email: u.email, id: u.id },
      };
    },
  },

  {
    method: "GET",
    match: /^\/log$/,
    handler: async (_p, q) => {
      if (!existsSync(LOG)) return { text: "no requests logged yet", data: { lines: [] } };
      const all = (await readFile(LOG, "utf8")).trim().split("\n").filter(Boolean);
      const lines = all.slice(-Number(q.get("lines") ?? 40));
      return { text: lines.join("\n"), data: { total: all.length, lines } };
    },
  },
];
