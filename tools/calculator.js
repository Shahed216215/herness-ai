module.exports = {
  name: "calculator",

  declaration: {
    name: "calculator",
    description: "Calculate a mathematical expression.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Mathematical expression"
        }
      },
      required: ["expression"]
    }
  },

  execute: async ({ expression }) => {
    if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
      return "Invalid calculation.";
    }

    try {
      const result = Function(
        `"use strict"; return (${expression})`
      )();

      if (!Number.isFinite(result)) {
        return "Invalid result.";
      }

      return String(result);
    } catch {
      return "Could not calculate.";
    }
  }
};
