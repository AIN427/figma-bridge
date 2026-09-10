/**
 * Compact text renderers. Everything here exists for one reason: a line of
 * plain text costs the agent 5-10x less than the same facts as Figma JSON.
 */

const CONTAINERS = new Set([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
  "GROUP",
]);

// Which field groups each preset switches on.
const PRESETS = {
  outline: [],
  layout: ["layout"],
  text: ["text"],
  style: ["style"],
  full: ["layout", "text", "style"],
};

const MAX_NODES = { outline: 400, layout: 300, text: 300, style: 250, full: 200 };

export const presetNames = Object.keys(PRESETS);
export const defaultMaxNodes = (preset) => MAX_NODES[preset] ?? 250;

export function fieldsFor(preset, include) {
  const set = new Set(PRESETS[preset] ?? []);
  for (const f of include) set.add(f);
  return set;
}

const round = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : n);

function hex(color) {
  if (!color) return null;
  const c = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  const base = `#${c(color.r)}${c(color.g)}${c(color.b)}`;
  return color.a != null && color.a < 1 ? `${base}/${Math.round(color.a * 100)}%` : base;
}

/** Names a paint by its style, then its bound variable, then its raw value. */
function paint(p, styleName, varName) {
  if (styleName) return styleName;
  if (varName) return varName;
  if (!p) return null;
  if (p.type === "SOLID") return hex(p.color);
  if (p.type?.startsWith("GRADIENT")) return p.type.toLowerCase();
  if (p.type === "IMAGE") return "image";
  return p.type?.toLowerCase() ?? null;
}

function size(n) {
  const b = n.absoluteBoundingBox;
  if (!b) return null;
  return `${round(b.width)}x${round(b.height)}`;
}

function layoutBits(n) {
  const out = [];
  if (n.layoutMode === "HORIZONTAL") out.push("row");
  if (n.layoutMode === "VERTICAL") out.push("col");
  if (n.itemSpacing) out.push(`gap${round(n.itemSpacing)}`);

  const p = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => v ?? 0);
  if (p.some(Boolean)) {
    const uniform = p.every((v) => v === p[0]);
    out.push(uniform ? `pad${round(p[0])}` : `pad${p.map(round).join("/")}`);
  }
  if (n.primaryAxisAlignItems && n.primaryAxisAlignItems !== "MIN")
    out.push(`main:${n.primaryAxisAlignItems.toLowerCase()}`);
  if (n.counterAxisAlignItems && n.counterAxisAlignItems !== "MIN")
    out.push(`cross:${n.counterAxisAlignItems.toLowerCase()}`);
  if (n.layoutGrow) out.push("grow");
  if (n.constraints && (n.constraints.horizontal !== "LEFT" || n.constraints.vertical !== "TOP"))
    out.push(`fix:${n.constraints.horizontal[0]}${n.constraints.vertical[0]}`.toLowerCase());
  return out;
}

function styleBits(n, styles, vars) {
  const out = [];
  const named = (key) => styles?.[n.styles?.[key]]?.name;
  const bound = (key) => {
    const b = n.boundVariables?.[key];
    const id = Array.isArray(b) ? b[0]?.id : b?.id;
    return id ? vars?.[id] ?? "var:?" : null;
  };

  const fill = paint(n.fills?.find((f) => f.visible !== false), named("fill"), bound("fills"));
  if (fill) out.push(`fill=${fill}`);

  const stroke = paint(n.strokes?.find((s) => s.visible !== false), named("stroke"), bound("strokes"));
  if (stroke) out.push(`stroke=${stroke}${n.strokeWeight ? `:${round(n.strokeWeight)}` : ""}`);

  if (n.cornerRadius) out.push(`r${round(n.cornerRadius)}`);
  else if (n.rectangleCornerRadii?.some(Boolean)) out.push(`r${n.rectangleCornerRadii.map(round).join("/")}`);

  const effect = named("effect") ?? n.effects?.find((e) => e.visible !== false)?.type?.toLowerCase();
  if (effect) out.push(`fx=${effect}`);

  if (n.opacity != null && n.opacity < 1) out.push(`op${Math.round(n.opacity * 100)}%`);
  if (n.visible === false) out.push("hidden");
  return out;
}

function textBits(n, styles) {
  if (n.type !== "TEXT") return [];
  const out = [];
  const s = n.style ?? {};
  const named = styles?.[n.styles?.text]?.name;
  if (named) out.push(`text=${named}`);
  else if (s.fontSize) out.push(`${s.fontFamily ?? ""}${s.fontWeight ? " " + s.fontWeight : ""} ${round(s.fontSize)}`.trim());
  return out;
}

function quote(chars) {
  if (!chars) return "";
  const one = chars.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `"${one.slice(0, 80)}..."` : `"${one}"`;
}

/**
 * Walks a subtree into rows. Bounded by maxNodes and depth; when the budget
 * runs out it reports how much it skipped rather than truncating silently.
 *
 * Rows stay structured so the same walk can serve both the compact text output
 * and `json=1` — no second traversal, no text that has to be parsed back.
 */
export function renderTree(root, { fields, depth = Infinity, maxNodes = 250, styles, vars }) {
  const rows = [];
  let visited = 0;
  let skipped = 0;

  const walk = (n, level) => {
    if (visited >= maxNodes) {
      skipped += 1 + countDescendants(n);
      return;
    }
    visited++;

    const bits = [];
    if (fields.has("layout")) bits.push(...layoutBits(n));
    if (fields.has("style")) bits.push(...styleBits(n, styles, vars));
    if (fields.has("text")) {
      bits.push(...textBits(n, styles));
      if (n.type === "TEXT") bits.push(quote(n.characters));
    }

    rows.push({
      level,
      name: n.name || "(unnamed)",
      type: n.type,
      size: size(n),
      bits: bits.filter(Boolean),
      id: n.id,
    });

    if (level >= depth) {
      skipped += countDescendants(n);
      return;
    }
    for (const c of n.children ?? []) walk(c, level + 1);
  };

  walk(root, 0);
  return { rows, visited, skipped };
}

/** One row per line, indented by depth. The cheap representation. */
export function treeToText(rows) {
  return rows
    .map((r) =>
      ["  ".repeat(r.level) + r.name, r.type, r.size, ...r.bits, `#${r.id}`]
        .filter(Boolean)
        .join("  "),
    )
    .join("\n");
}

function countDescendants(n) {
  let total = 0;
  for (const c of n.children ?? []) total += 1 + countDescendants(c);
  return total;
}

/** Collects every string on a screen, in reading order. */
export function collectText(root) {
  const out = [];
  const walk = (n, trail) => {
    const here = [...trail, n.name].filter(Boolean);
    if (n.type === "TEXT" && n.characters?.trim()) {
      out.push({ path: here.join(" / "), id: n.id, text: n.characters.replace(/\n/g, "\\n") });
    }
    for (const c of n.children ?? []) walk(c, here);
  };
  walk(root, []);
  return out;
}

/**
 * Searches every node in the file by name, by text content, or by type, and
 * reports each hit with the page and screen it lives on — the "where is this"
 * handle. Filters combine with AND.
 */
export function findNodes(doc, { name, text, type, limit = 60 }) {
  const wantName = name?.toLowerCase();
  const wantText = text?.toLowerCase();
  const wantType = type?.toUpperCase();
  const hits = [];
  let over = 0;

  const walk = (n, page, screen, trail) => {
    const nameHit = !wantName || (n.name ?? "").toLowerCase().includes(wantName);
    const textHit = !wantText || (n.characters ?? "").toLowerCase().includes(wantText);
    const typeHit = !wantType || n.type === wantType;

    if (nameHit && textHit && typeHit) {
      if (hits.length < limit) {
        hits.push({
          page,
          screen,
          path: trail.join(" / "),
          type: n.type,
          id: n.id,
          text: n.type === "TEXT" ? quote(n.characters) : "",
        });
      } else over++;
    }

    for (const c of n.children ?? []) {
      // A screen is the first container below a page or a section.
      const nextScreen =
        screen ?? (CONTAINERS.has(c.type) && c.type !== "SECTION" ? c.name : null);
      walk(c, page, nextScreen, [...trail, c.name].filter(Boolean));
    }
  };

  for (const page of doc.children ?? []) walk(page, page.name, null, []);
  return { hits, over };
}

/** Top-level frames on a page, flattened one level through sections. */
export function collectScreens(page) {
  const out = [];
  for (const child of page.children ?? []) {
    if (child.type === "SECTION") {
      for (const inner of child.children ?? []) {
        if (CONTAINERS.has(inner.type)) out.push({ node: inner, section: child.name });
      }
    } else if (CONTAINERS.has(child.type)) {
      out.push({ node: child, section: null });
    }
  }
  return out;
}
