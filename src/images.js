import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { download, get } from "./figma-api.js";
import { FigmaError } from "./errors.js";
import { CACHE_DIR } from "./cache.js";

const RENDER_DIR = path.join(CACHE_DIR, "renders");

// Conservative: the images endpoint rejects very long id lists.
const IDS_PER_CALL = 20;

/** Vector defaults suit icon export; every one of them is overridable. */
export const SVG_DEFAULTS = {
  svg_outline_text: "false",
  svg_simplify_stroke: "true",
  svg_include_id: "false",
};

/**
 * Renders nodes and saves them to disk, returning paths rather than image
 * bytes — the caller decides whether an image is worth spending context on.
 */
export async function renderNodes(key, ids, { scale = 2, format = "png", svg } = {}) {
  const dir = path.join(RENDER_DIR, key);
  await mkdir(dir, { recursive: true });
  const vector = format === "svg";

  const out = [];
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
    const chunk = ids.slice(i, i + IDS_PER_CALL);
    const q = new URLSearchParams({ ids: chunk.join(","), format });
    // Scale is meaningless for vector output; svg_* options only apply to it.
    if (vector) for (const [k, v] of Object.entries(svg ?? SVG_DEFAULTS)) q.set(k, String(v));
    else q.set("scale", String(scale));

    const { images, err } = await get(`/images/${key}?${q}`);
    if (err) throw new FigmaError(502, String(err));

    // Downloads within a chunk are independent — run them together rather
    // than paying one round trip per icon.
    const saved = await Promise.all(
      Object.entries(images).map(async ([id, url]) => {
        if (!url) return { id, error: "figma returned no url (empty or unrenderable node)" };
        try {
          const bytes = await download(url);
          const safe = id.replace(/[:/]/g, "-");
          const file = path.join(dir, vector ? `${safe}.svg` : `${safe}@${scale}x.${format}`);
          await writeFile(file, bytes);
          return { id, file, bytes: bytes.length };
        } catch (e) {
          return { id, error: e.message };
        }
      }),
    );
    out.push(...saved);
  }
  return out;
}
