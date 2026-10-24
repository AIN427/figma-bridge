import { presetNames } from "../src/format.js";

export const HELP = `figma bridge — levels of detail, cheapest first

  GET /health                                 port, token, last Figma 429 — no Figma call
  GET /me                                     token check: user + plan
  GET /log[?lines=40]                         request log — who asked what

  add &by=<your-session-name> to any call so the log says who you are

  -- what exists (start here) --
  GET  /files[?q=]                            the registry: every known file
  POST /files  {url|key, alias?}              register one file by URL
  DEL  /files/:key                            forget one
  GET  /discover?team=:teamIdOrUrl            walk a team, register everything
  GET  /search?q=&text=&type=[&fetch=1]       search across ALL known files

  GET /projects?team=:teamIdOrUrl             projects in a team
  GET /project/:id                            files in one project

  -- inside one file --
  GET /f/:key                                 file meta + page list
  GET /f/:key/screens[?page=&q=&limit=&offset=]  top-level frames, 150 at a time
  GET /f/:key/find?q=&text=&type=&limit=      any node anywhere: name, text, type
  GET /f/:key/screen/:node[?detail=&depth=&maxNodes=&include=]
  GET /f/:key/text?screen=:node               every string on one screen
  GET /f/:key/node/:node                      one node, raw JSON
  GET /f/:key/render?ids=a,b[&format=png|svg&scale=2]   to disk, returns paths
        format=svg for icons -> VectorDrawable; scale ignored for vector
        svg_outline_text=false  svg_simplify_stroke=true  svg_include_id=false

  :key      file key, full figma.com URL, or an alias from the registry
  detail    ${presetNames.join(" | ")}   (default: outline)
  include   extra field groups on top of the preset: layout,text,style
  refresh=1 bypass the cached file JSON
  json=1    structured JSON instead of text

  POST /variables   {fileKey, variables:{id:name}}   map pushed by a plugin
`;
