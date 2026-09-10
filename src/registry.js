import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { BadRequest } from "./errors.js";
import { keyFromUrl, looksLikeKey, projectFiles, shallow, teamProjects } from "./figma-api.js";

const ROOT = path.join(import.meta.dirname, "..");
const REGISTRY = path.join(ROOT, "files.json");

/**
 * Figma's REST API has no "list all my files" endpoint and cannot enumerate
 * Drafts at all. Without this local index an agent has nothing to choose from,
 * which is why the registry exists rather than being derived on demand.
 */
export async function readRegistry() {
  if (!existsSync(REGISTRY)) return { files: {} };
  const raw = JSON.parse(await readFile(REGISTRY, "utf8"));
  if (raw.files) return raw;
  // Older shape: a flat {alias: key} map.
  const files = {};
  for (const [alias, key] of Object.entries(raw)) files[key] = { alias };
  return { files };
}

async function writeRegistry(reg) {
  await writeFile(REGISTRY, JSON.stringify(reg, null, 2), "utf8");
}

/** Registers one file by key or URL, looking up its real name as it goes. */
export async function addFile(input, { alias, project, team } = {}) {
  const key = keyFromUrl(input) ?? input;
  if (!looksLikeKey(key)) throw new BadRequest(`not a file key or URL: ${input}`);

  const head = await shallow(key);
  const reg = await readRegistry();
  reg.files[key] = {
    name: head.name,
    alias: alias ?? reg.files[key]?.alias,
    project: project ?? reg.files[key]?.project,
    team: team ?? reg.files[key]?.team,
    lastModified: head.lastModified,
  };
  await writeRegistry(reg);
  return { key, ...reg.files[key] };
}

export async function forgetFile(key) {
  const reg = await readRegistry();
  const existed = Boolean(reg.files[key]);
  delete reg.files[key];
  await writeRegistry(reg);
  return existed;
}

/**
 * Walks a team down to every file and registers all of them in one call.
 * Only reaches team projects — files in Drafts stay invisible to the API.
 */
export async function discoverTeam(input) {
  const teamId = input.match(/\/team\/(\d+)/)?.[1] ?? input;
  const { name: teamName, projects } = await teamProjects(teamId);
  const reg = await readRegistry();
  const added = [];

  for (const project of projects) {
    const { files } = await projectFiles(project.id);
    for (const f of files) {
      const known = reg.files[f.key];
      reg.files[f.key] = {
        name: f.name,
        alias: known?.alias,
        project: project.name,
        team: teamName,
        lastModified: f.last_modified,
      };
      added.push({ key: f.key, name: f.name, project: project.name, isNew: !known });
    }
  }
  await writeRegistry(reg);
  return { team: teamName, projects: projects.length, files: added };
}

/**
 * Resolves whatever the caller typed into a file key: a raw key, a figma.com
 * URL, a registered alias, or an unambiguous piece of a registered file name.
 * Exported with the registry injected so it can be unit-tested without disk.
 */
export function resolveKeyIn(files, input) {
  const fromUrl = keyFromUrl(input);
  if (fromUrl) return fromUrl;
  if (looksLikeKey(input)) return input;

  const byAlias = Object.entries(files).find(([, v]) => v.alias === input);
  if (byAlias) return byAlias[0];

  const byName = Object.entries(files).filter(([, v]) =>
    v.name?.toLowerCase().includes(input.toLowerCase()),
  );
  if (byName.length === 1) return byName[0][0];
  if (byName.length > 1)
    throw new BadRequest(`"${input}" matches ${byName.length} files — use a key or alias`);

  throw new BadRequest(`unknown file: ${input} — see GET /files, or POST /files to register it`);
}

export async function resolveKey(input) {
  const { files } = await readRegistry();
  return resolveKeyIn(files, input);
}
