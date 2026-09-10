import { BadRequest } from "../src/errors.js";
import { getFile, isCached } from "../src/cache.js";
import { projectFiles, teamProjects } from "../src/figma-api.js";
import { addFile, discoverTeam, forgetFile, readRegistry } from "../src/registry.js";
import { findNodes } from "../src/format.js";

const EMPTY_REGISTRY = [
  "registry is empty — nothing to search yet.",
  "",
  "add files one of two ways:",
  '  POST /files {"url": "<figma.com file url>", "alias": "optional-short-name"}',
  "  GET  /discover?team=<team id or figma.com team URL>   (team projects only)",
  "",
  "note: Figma's API cannot list Drafts. Files kept in Drafts must be added by URL.",
].join("\n");

export const files = [
  {
    method: "GET",
    match: /^\/files$/,
    handler: async (_p, q) => {
      const { files: known } = await readRegistry();
      let rows = Object.entries(known);
      if (!rows.length) return { text: EMPTY_REGISTRY, data: { files: [] } };

      const filter = q.get("q")?.toLowerCase();
      if (filter) rows = rows.filter(([, v]) => v.name?.toLowerCase().includes(filter));

      const data = rows.map(([key, v]) => ({
        key,
        name: v.name ?? null,
        alias: v.alias ?? null,
        project: v.project ?? null,
        cached: isCached(key),
        lastModified: v.lastModified ?? null,
      }));

      const grouped = new Map();
      for (const f of data) {
        const bucket = f.project ?? "Drafts / added by URL";
        if (!grouped.has(bucket)) grouped.set(bucket, []);
        grouped.get(bucket).push(f);
      }

      const text = [];
      for (const [project, entries] of grouped) {
        text.push(project);
        for (const f of entries) {
          text.push(
            `  ${f.name ?? "(unnamed)"}${f.alias ? `  [${f.alias}]` : ""}  ${f.key}` +
              `  ${f.cached ? "cached" : "not fetched"}` +
              `${f.lastModified ? `  edited ${f.lastModified.slice(0, 10)}` : ""}`,
          );
        }
      }
      return { text: text.join("\n"), data: { files: data } };
    },
  },

  {
    method: "POST",
    match: /^\/files$/,
    handler: async (_p, _q, body) => {
      const { url, key, alias } = JSON.parse(body || "{}");
      if (!url && !key) throw new BadRequest('expected {"url": "..."} or {"key": "..."}');
      const entry = await addFile(url ?? key, { alias });
      return {
        text: `registered: ${entry.name}  ${entry.key}${entry.alias ? `  [${entry.alias}]` : ""}`,
        data: entry,
      };
    },
  },

  {
    method: "DELETE",
    match: /^\/files\/([^/]+)$/,
    handler: async ([key]) => {
      const removed = await forgetFile(key);
      return {
        text: removed ? `removed ${key}` : `${key} was not in the registry`,
        data: { key, removed },
      };
    },
  },

  {
    method: "GET",
    match: /^\/discover$/,
    handler: async (_p, q) => {
      const team = q.get("team");
      if (!team) throw new BadRequest("team=<team id or figma.com team URL> is required");
      const res = await discoverTeam(team);
      const fresh = res.files.filter((f) => f.isNew).length;
      const text = [
        `team ${res.team}: ${res.projects} projects, ${res.files.length} files (${fresh} new)`,
        "",
        ...res.files.map((f) => `  ${f.project} / ${f.name}  ${f.key}${f.isNew ? "  NEW" : ""}`),
      ].join("\n");
      return { text, data: res };
    },
  },

  {
    method: "GET",
    match: /^\/search$/,
    handler: async (_p, q) => {
      const name = q.get("q");
      const text = q.get("text");
      if (!name && !text) throw new BadRequest("need q=<name> or text=<content>");

      const { files: known } = await readRegistry();
      const keys = Object.keys(known);
      if (!keys.length) throw new BadRequest("registry is empty — see GET /files");

      // Only searches files already on disk unless fetch=1, so a stray query
      // cannot trigger a dozen full-file downloads.
      const fetchAll = q.has("fetch");
      const skipped = [];
      const matches = [];

      for (const key of keys) {
        if (!fetchAll && !isCached(key)) {
          skipped.push(known[key].name ?? key);
          continue;
        }
        const file = await getFile(key);
        const { hits } = findNodes(file.document, {
          name,
          text,
          type: q.get("type"),
          limit: Number(q.get("limit") ?? 15),
        });
        if (hits.length) matches.push({ file: file.name, key, hits });
      }

      const lines = [];
      for (const m of matches) {
        lines.push(`${m.file}  ${m.key}`);
        for (const h of m.hits)
          lines.push(`  ${h.page} / ${h.screen ?? "-"} / ${h.path}  ${h.type}  ${h.text}  #${h.id}`);
      }
      const foot = skipped.length
        ? `\n\nnot searched (never fetched): ${skipped.join(", ")} — add fetch=1 to pull them`
        : "";

      return {
        text: (lines.length ? lines.join("\n") : "no matches in cached files") + foot,
        data: { matches, skipped },
      };
    },
  },

  {
    method: "GET",
    match: /^\/projects$/,
    handler: async (_p, q) => {
      const raw = q.get("team");
      if (!raw) throw new BadRequest("team=<teamId or figma.com team URL> is required");
      const teamId = raw.match(/\/team\/(\d+)/)?.[1] ?? raw;
      const { name, projects } = await teamProjects(teamId);
      return {
        text: [`team: ${name}`, ...projects.map((p) => `  ${p.name}  #${p.id}`)].join("\n"),
        data: { team: name, projects },
      };
    },
  },

  {
    method: "GET",
    match: /^\/project\/([^/]+)$/,
    handler: async ([id]) => {
      const { name, files: list } = await projectFiles(id);
      return {
        text: [
          `project: ${name}`,
          ...list.map((f) => `  ${f.name}  ${f.key}  edited ${f.last_modified}`),
        ].join("\n"),
        data: { project: name, files: list },
      };
    },
  },
];
