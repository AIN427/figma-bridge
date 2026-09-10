import { diagnostics } from "./diagnostics.js";
import { files } from "./files.js";
import { file } from "./file.js";
import { variables } from "./variables.js";

export { HELP } from "./help.js";

/**
 * The route table, in match order.
 *
 * A handler receives (pathParams, searchParams, body) and returns either:
 *   - a string             — the text response; `json=1` wraps it as {text}
 *   - { text, data }       — text for humans and agents, `data` for `json=1`
 *
 * Keeping both in one return is what makes `json=1` honest: the structured
 * form is the same walk that produced the text, not a re-parse of it.
 */
export const routes = [...diagnostics, ...files, ...file, ...variables];
