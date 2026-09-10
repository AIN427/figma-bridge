import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectScreens,
  collectText,
  fieldsFor,
  findNodes,
  renderTree,
  treeToText,
} from "../src/format.js";

/** A miniature document: one page, one plain screen, one screen in a section. */
const doc = {
  id: "0:0",
  name: "Document",
  type: "DOCUMENT",
  children: [
    {
      id: "1:0",
      name: "Page One",
      type: "CANVAS",
      children: [
        {
          id: "1:1",
          name: "Login",
          type: "FRAME",
          absoluteBoundingBox: { width: 375, height: 812 },
          children: [
            {
              id: "1:2",
              name: "Title",
              type: "TEXT",
              characters: "Sign in",
              absoluteBoundingBox: { width: 100, height: 20 },
            },
          ],
        },
        {
          id: "1:5",
          name: "Errors",
          type: "SECTION",
          children: [
            {
              id: "1:6",
              name: "Error 404",
              type: "FRAME",
              absoluteBoundingBox: { width: 375, height: 812 },
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

const page = doc.children[0];
const login = page.children[0];

test("collectScreens flattens one level through sections", () => {
  const screens = collectScreens(page);
  assert.equal(screens.length, 2);
  assert.equal(screens[0].node.name, "Login");
  assert.equal(screens[0].section, null);
  assert.equal(screens[1].node.name, "Error 404");
  assert.equal(screens[1].section, "Errors");
});

test("findNodes locates a node by the text on it, with page and screen", () => {
  const { hits } = findNodes(doc, { text: "sign" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "1:2");
  assert.equal(hits[0].page, "Page One");
  assert.equal(hits[0].screen, "Login");
});

test("findNodes combines filters with AND", () => {
  assert.equal(findNodes(doc, { text: "sign", type: "FRAME" }).hits.length, 0);
  assert.equal(findNodes(doc, { text: "sign", type: "TEXT" }).hits.length, 1);
});

test("findNodes reports what the limit cut off", () => {
  const { hits, over } = findNodes(doc, { type: "FRAME", limit: 1 });
  assert.equal(hits.length, 1);
  assert.equal(over, 1);
});

test("renderTree reports skipped nodes instead of truncating silently", () => {
  const full = renderTree(login, { fields: fieldsFor("outline", []) });
  assert.equal(full.visited, 2);
  assert.equal(full.skipped, 0);

  const capped = renderTree(login, { fields: fieldsFor("outline", []), maxNodes: 1 });
  assert.equal(capped.visited, 1);
  assert.equal(capped.skipped, 1);
});

test("renderTree stops descending at the requested depth", () => {
  const shallow = renderTree(login, { fields: fieldsFor("outline", []), depth: 0 });
  assert.equal(shallow.rows.length, 1);
  assert.equal(shallow.skipped, 1);
});

test("text preset carries the actual string, outline does not", () => {
  const outline = renderTree(login, { fields: fieldsFor("outline", []) });
  const withText = renderTree(login, { fields: fieldsFor("text", []) });
  assert.ok(!treeToText(outline.rows).includes("Sign in"));
  assert.ok(treeToText(withText.rows).includes('"Sign in"'));
});

test("treeToText indents by depth and keeps the id", () => {
  const { rows } = renderTree(login, { fields: fieldsFor("outline", []) });
  const lines = treeToText(rows).split("\n");
  assert.ok(lines[0].startsWith("Login  FRAME  375x812"));
  assert.ok(lines[1].startsWith("  Title"));
  assert.ok(lines[0].endsWith("#1:1"));
});

test("include adds field groups on top of a preset", () => {
  assert.deepEqual([...fieldsFor("outline", [])], []);
  assert.deepEqual([...fieldsFor("outline", ["style"])], ["style"]);
  assert.deepEqual([...fieldsFor("full", [])].sort(), ["layout", "style", "text"]);
});

test("collectText returns every string with its path", () => {
  const strings = collectText(login);
  assert.equal(strings.length, 1);
  assert.equal(strings[0].text, "Sign in");
  assert.equal(strings[0].path, "Login / Title");
});
