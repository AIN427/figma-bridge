import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR } from "./src/cache.js";
import { HELP, routes } from "./routes/index.js";

try {
  process.loadEnvFile(path.join(import.meta.dirname, ".env"));
} catch {
  // No .env file — fall back to whatever is already in the environment.
}

const PORT = Number(process.env.PORT ?? 3846);
// Hard ceiling on any single response, so one careless call cannot flood a
// context window. Counted in bytes, because that is what actually travels.
const MAX_BYTES = Number(process.env.MAX_RESPONSE_BYTES ?? 60_000);
const LOG = path.join(CACHE_DIR, "access.log");

/** Every request is appended here — who asked, for what, how much came back. */
async function logLine(entry) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await appendFile(LOG, entry + "\n", "utf8");
  } catch {
    // Logging must never take the server down.
  }
}

/** Trims to a byte budget without slicing a multi-byte character in half. */
function capBytes(text) {
  if (Buffer.byteLength(text) <= MAX_BYTES) return text;
  const cut = Buffer.from(text, "utf8").subarray(0, MAX_BYTES);
  const safe = new TextDecoder("utf-8").decode(cut).replace(/�$/, "");
  return `${safe}\n\n... response truncated at ${MAX_BYTES} bytes — narrow the query`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = routes.find((r) => r.method === req.method && r.match.test(url.pathname));
  const started = Date.now();

  const send = (status, text, contentType = "text/plain") => {
    res.writeHead(status, {
      "content-type": `${contentType}; charset=utf-8`,
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
    });
    res.end(text);

    const who = url.searchParams.get("by") ?? req.headers["x-client"] ?? "-";
    const secs = ((Date.now() - started) / 1000).toFixed(2);
    logLine(
      `${new Date().toISOString()}  ${req.method} ${url.pathname}${url.search}  ` +
        `${status}  ${Buffer.byteLength(text)}b  ${secs}s  by=${who}`,
    );
  };

  if (req.method === "OPTIONS") return send(204, "");
  if (!route) return send(404, `no route for ${req.method} ${url.pathname}\n\n${HELP}`);

  const wantsJson = url.searchParams.has("json");

  try {
    let body = "";
    if (req.method === "POST") {
      for await (const chunk of req) body += chunk;
    }

    const params = url.pathname.match(route.match).slice(1);
    const result = await route.handler(params, url.searchParams, body);
    const text = typeof result === "string" ? result : result.text;
    const data = typeof result === "string" ? { text: result } : result.data;

    if (!wantsJson) return send(200, capBytes(text));

    // Truncated JSON is unparseable, so oversized payloads are refused with a
    // usable message instead of being cut into something that looks like data.
    const json = JSON.stringify(data, null, 2);
    if (Buffer.byteLength(json) > MAX_BYTES)
      return send(
        413,
        JSON.stringify(
          {
            error: "response too large for json output",
            bytes: Buffer.byteLength(json),
            limit: MAX_BYTES,
            hint: "narrow with limit=, maxNodes=, depth= or drop json=1 for the text form",
          },
          null,
          2,
        ),
        "application/json",
      );
    send(200, json, "application/json");
  } catch (err) {
    const status = err.status ?? 500;
    if (wantsJson)
      return send(
        status,
        JSON.stringify(
          { error: err.message, upstream: Boolean(err.upstream), rateLimit: err.rateLimit },
          null,
          2,
        ),
        "application/json",
      );
    send(status, `ERROR ${err.message}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `figma bridge on http://127.0.0.1:${PORT}  (token ${process.env.FIGMA_TOKEN ? "set" : "MISSING"})`,
  );
});
