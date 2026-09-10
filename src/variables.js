import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "./cache.js";

/**
 * Figma's Variables REST API is Enterprise-only, so variable *names* cannot be
 * read on ordinary plans. A plugin running inside Figma can read them and push
 * the id -> name map here; until it does, bound variables show as `var:?`.
 */
const mapFile = (fileKey) => path.join(CACHE_DIR, `vars-${fileKey}.json`);

export async function loadVariableNames(fileKey) {
  const file = mapFile(fileKey);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

export async function saveVariableNames(fileKey, names) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(mapFile(fileKey), JSON.stringify(names), "utf8");
  return Object.keys(names).length;
}
