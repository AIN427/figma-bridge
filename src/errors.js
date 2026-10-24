import { describeRateLimit } from "./rate-limit.js";

/**
 * Two kinds of failure, deliberately kept apart: the ones we cause by asking
 * badly, and the ones Figma reports back. Labelling our own validation as
 * "Figma API 400" sends people debugging the wrong system.
 */

/** The caller asked for something we cannot serve. Our fault to explain. */
export class BadRequest extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Figma answered with an error. The status and text are theirs, not ours.
 * On a 429 `rateLimit` carries what Figma said about the limit, if anything.
 */
export class FigmaError extends Error {
  constructor(status, body, rateLimit) {
    const said = rateLimit ? describeRateLimit(rateLimit) : "";
    super(`Figma API ${status}: ${body}${said ? ` · ${said}` : ""}`);
    this.status = status;
    this.upstream = true;
    this.body = body;
    if (rateLimit) this.rateLimit = rateLimit;
  }
}
