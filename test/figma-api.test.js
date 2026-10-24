import { test } from "node:test";
import assert from "node:assert/strict";
import { meta } from "../src/figma-api.js";

test("the version check asks /meta, never a /files/:key read from the monthly quota", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(String(url));
    return Response.json({ file: { name: "Design", version: "42" } });
  });
  process.env.FIGMA_TOKEN ??= "test-token";

  const head = await meta("AAAAAAAAAAAAAAAA");

  assert.equal(head.version, "42");
  assert.equal(head.name, "Design");
  assert.deepEqual(asked, ["https://api.figma.com/v1/files/AAAAAAAAAAAAAAAA/meta"]);
});
