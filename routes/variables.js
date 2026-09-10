import { BadRequest } from "../src/errors.js";
import { saveVariableNames } from "../src/variables.js";

export const variables = [
  {
    method: "POST",
    match: /^\/variables$/,
    handler: async (_p, _q, body) => {
      const { fileKey, variables: names } = JSON.parse(body || "{}");
      if (!fileKey || !names) throw new BadRequest("expected {fileKey, variables}");
      const count = await saveVariableNames(fileKey, names);
      return {
        text: `stored ${count} variable names for ${fileKey}`,
        data: { fileKey, stored: count },
      };
    },
  },
];
