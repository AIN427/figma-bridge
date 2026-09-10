import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveKeyIn } from "../src/registry.js";
import { keyFromUrl, looksLikeKey } from "../src/figma-api.js";

const files = {
  AAAAAAAAAAAAAAAA: { name: "My App", alias: "app" },
  BBBBBBBBBBBBBBBB: { name: "My Other App" },
};

test("keyFromUrl handles every figma.com url shape", () => {
  assert.equal(keyFromUrl("https://www.figma.com/design/XYZ123abc456def/Thing"), "XYZ123abc456def");
  assert.equal(keyFromUrl("https://figma.com/file/XYZ123abc456def/Old?node-id=1"), "XYZ123abc456def");
  assert.equal(keyFromUrl("not a url"), null);
});

test("looksLikeKey rejects short or punctuated input", () => {
  assert.equal(looksLikeKey("AAAAAAAAAAAAAAAA"), true);
  assert.equal(looksLikeKey("app"), false);
  assert.equal(looksLikeKey("has-a-dash-and-is-long"), false);
});

test("resolveKeyIn accepts a url, a raw key, and an alias", () => {
  assert.equal(
    resolveKeyIn(files, "https://www.figma.com/design/XYZ123abc456def/Thing"),
    "XYZ123abc456def",
  );
  assert.equal(resolveKeyIn(files, "AAAAAAAAAAAAAAAA"), "AAAAAAAAAAAAAAAA");
  assert.equal(resolveKeyIn(files, "app"), "AAAAAAAAAAAAAAAA");
});

test("resolveKeyIn accepts an unambiguous piece of a file name", () => {
  assert.equal(resolveKeyIn(files, "Other"), "BBBBBBBBBBBBBBBB");
});

test("resolveKeyIn refuses an ambiguous name rather than guessing", () => {
  assert.throws(() => resolveKeyIn(files, "My"), /matches 2 files/);
});

test("an unknown file points the caller at the registry", () => {
  assert.throws(() => resolveKeyIn(files, "nothing-like-this"), /see GET \/files/);
});

test("errors from our own validation carry a 400, not a server fault", () => {
  try {
    resolveKeyIn(files, "nothing-like-this");
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.status, 400);
    assert.ok(!err.message.includes("Figma API"), "must not blame Figma for our validation");
  }
});
