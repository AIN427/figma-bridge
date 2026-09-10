import { BadRequest } from "../src/errors.js";
import { findNode, getFile } from "../src/cache.js";
import { renderNodes, SVG_DEFAULTS } from "../src/images.js";
import { resolveKey } from "../src/registry.js";
import { loadVariableNames } from "../src/variables.js";
import {
  collectScreens,
  collectText,
  defaultMaxNodes,
  fieldsFor,
  findNodes,
  presetNames,
  renderTree,
  treeToText,
} from "../src/format.js";

/** Every route here starts by turning whatever was typed into a real key. */
const open = async (key, q) =>
  getFile(await resolveKey(key), { refresh: q.has("refresh") });

function pagesOf(document, selector) {
  const pages = document.children ?? [];
  if (!selector) return pages;
  const lower = selector.toLowerCase();
  return pages.filter((p) => p.id === selector || p.name.toLowerCase().includes(lower));
}

export const file = [
  {
    method: "GET",
    match: /^\/f\/([^/]+)$/,
    handler: async ([key], q) => {
      const f = await open(key, q);
      const pages = (f.document.children ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        screens: collectScreens(p).length,
      }));
      const text = [
        `${f.name}  v${f.version}  edited ${f.lastModified}  (${f.cached || "fetched"})`,
        "",
        "pages:",
        ...pages.map((p) => `  ${p.name}  ${p.screens} screen${p.screens === 1 ? "" : "s"}  #${p.id}`),
      ].join("\n");
      return {
        text,
        data: {
          name: f.name,
          version: f.version,
          lastModified: f.lastModified,
          cached: f.cached || "fetched",
          pages,
        },
      };
    },
  },

  {
    method: "GET",
    match: /^\/f\/([^/]+)\/screens$/,
    handler: async ([key], q) => {
      const f = await open(key, q);
      const filter = q.get("q")?.toLowerCase();
      // Pages can hold over a thousand frames; never dump them all blindly.
      const limit = Number(q.get("limit") ?? 150);
      const offset = Number(q.get("offset") ?? 0);

      const out = [];
      let shown = 0;
      let remaining = 0;

      for (const page of pagesOf(f.document, q.get("page"))) {
        const all = collectScreens(page).filter(
          (s) => !filter || s.node.name.toLowerCase().includes(filter),
        );
        if (!all.length) continue;

        const window = all.slice(offset, offset + Math.max(0, limit - shown));
        remaining += all.length - offset - window.length;
        out.push({
          page: page.name,
          pageId: page.id,
          total: all.length,
          offset,
          screens: window.map(({ node, section }) => ({
            id: node.id,
            name: node.name,
            type: node.type,
            width: node.absoluteBoundingBox ? Math.round(node.absoluteBoundingBox.width) : null,
            height: node.absoluteBoundingBox ? Math.round(node.absoluteBoundingBox.height) : null,
            section,
          })),
        });
        shown += window.length;
      }

      if (!out.length) return { text: "no screens matched", data: { pages: [], remaining: 0 } };

      const lines = [];
      for (const p of out) {
        lines.push(
          `${p.page}  #${p.pageId}  ${p.total} screen${p.total === 1 ? "" : "s"}` +
            (p.screens.length < p.total
              ? `, showing ${p.offset + 1}-${p.offset + p.screens.length}`
              : ""),
        );
        for (const s of p.screens)
          lines.push(
            `  ${s.name}  ${s.width ?? "-"}x${s.height ?? "-"}  ${s.type}  #${s.id}` +
              (s.section ? `  [${s.section}]` : ""),
          );
      }
      if (remaining > 0)
        lines.push(
          "",
          `... ${remaining} more — narrow with q=<name>, or page through with offset=${offset + shown}`,
        );

      return { text: lines.join("\n"), data: { pages: out, remaining } };
    },
  },

  {
    method: "GET",
    match: /^\/f\/([^/]+)\/find$/,
    handler: async ([key], q) => {
      if (!q.get("q") && !q.get("text") && !q.get("type"))
        throw new BadRequest("need at least one of: q=<name>, text=<content>, type=<NODETYPE>");

      const f = await open(key, q);
      const { hits, over } = findNodes(f.document, {
        name: q.get("q"),
        text: q.get("text"),
        type: q.get("type"),
        limit: Number(q.get("limit") ?? 60),
      });

      if (!hits.length) return { text: "no matches", data: { hits: [], over: 0 } };
      const lines = hits.map((h) =>
        [`${h.page} / ${h.screen ?? "-"} / ${h.path}`, h.type, h.text, `#${h.id}`]
          .filter(Boolean)
          .join("  "),
      );
      const foot = over ? `\n\n... ${over} more matches — narrow with type= or raise limit=` : "";
      return { text: lines.join("\n") + foot, data: { hits, over } };
    },
  },

  {
    method: "GET",
    match: /^\/f\/([^/]+)\/screen\/([^/]+)$/,
    handler: async ([key, nodeId], q) => {
      const fileKey = await resolveKey(key);
      const f = await getFile(fileKey, { refresh: q.has("refresh") });
      const id = decodeURIComponent(nodeId);
      const node = findNode(f.document, id);
      if (!node) throw new BadRequest(`node ${id} not found in ${f.name}`, 404);

      const detail = q.get("detail") ?? "outline";
      if (!presetNames.includes(detail))
        throw new BadRequest(`detail must be one of: ${presetNames.join(", ")}`);

      const include = (q.get("include") ?? "").split(",").filter(Boolean);
      const maxNodes = Number(q.get("maxNodes") ?? defaultMaxNodes(detail));
      const depth = q.has("depth") ? Number(q.get("depth")) : Infinity;

      const { rows, visited, skipped } = renderTree(node, {
        fields: fieldsFor(detail, include),
        depth,
        maxNodes,
        styles: f.styles,
        vars: await loadVariableNames(fileKey),
      });

      const foot = skipped
        ? `\n\n... ${skipped} more nodes not shown (detail=${detail}, maxNodes=${maxNodes}, depth=${
            depth === Infinity ? "all" : depth
          }) — raise maxNodes/depth or drill into a child id`
        : `\n\n${visited} nodes, complete`;

      return {
        text: treeToText(rows) + foot,
        data: { root: id, detail, visited, skipped, complete: skipped === 0, nodes: rows },
      };
    },
  },

  {
    method: "GET",
    match: /^\/f\/([^/]+)\/text$/,
    handler: async ([key], q) => {
      const screen = q.get("screen");
      if (!screen) throw new BadRequest("screen=<nodeId> is required");
      const f = await open(key, q);
      const node = findNode(f.document, screen);
      if (!node) throw new BadRequest(`node ${screen} not found`, 404);

      const strings = collectText(node);
      if (!strings.length)
        return { text: "no text nodes on this screen", data: { strings: [] } };

      // Only the tail of the path — the full chain from the screen root repeats
      // on every line and costs far more than it explains.
      const lines = strings.map((r) => {
        const tail = r.path.split(" / ").slice(-2).join(" / ");
        return `${r.text}  <- ${tail}  #${r.id}`;
      });
      return { text: lines.join("\n"), data: { strings } };
    },
  },

  {
    method: "GET",
    match: /^\/f\/([^/]+)\/node\/([^/]+)$/,
    handler: async ([key, nodeId], q) => {
      const f = await open(key, q);
      const id = decodeURIComponent(nodeId);
      const node = findNode(f.document, id);
      if (!node) throw new BadRequest(`node ${id} not found`, 404);
      return { text: JSON.stringify(node, null, 2), data: node };
    },
  },

  {
    method: "GET",
    match: /^\/f\/([^/]+)\/render$/,
    handler: async ([key], q) => {
      const ids = (q.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!ids.length) throw new BadRequest("ids=<nodeId,nodeId> is required");

      const format = q.get("format") ?? "png";
      const svg =
        format === "svg"
          ? Object.fromEntries(
              Object.entries(SVG_DEFAULTS).map(([k, v]) => [k, q.get(k) ?? v]),
            )
          : undefined;

      const results = await renderNodes(await resolveKey(key), ids, {
        scale: Number(q.get("scale") ?? 2),
        format,
        svg,
      });

      const text = results
        .map((r) =>
          r.error
            ? `${r.id}  ERROR ${r.error}`
            : `${r.id}  ${r.file}  ${Math.round(r.bytes / 1024)}kb`,
        )
        .join("\n");
      return { text, data: { results } };
    },
  },
];
