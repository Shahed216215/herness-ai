"use strict";

const tools = require("../tools");

const capacityChange =
  tools &&
  tools.tools &&
  tools.tools.capacity_change;

if (!capacityChange) {
  throw new Error(
    "capacity_change tool is not registered."
  );
}

if (capacityChange.name !== "capacity_change") {
  throw new Error(
    "capacity_change tool name mismatch."
  );
}

if (
  !capacityChange.declaration ||
  typeof capacityChange.declaration !== "object"
) {
  throw new Error(
    "capacity_change declaration is missing."
  );
}

if (
  typeof capacityChange.execute !== "function"
) {
  throw new Error(
    "capacity_change execute handler is missing."
  );
}

console.log(
  "CAPACITY_CHANGE_REGISTERED: true"
);
console.log(
  "CAPACITY_CHANGE_EXECUTE: true"
);
console.log(
  "CAPACITY_CHANGE_TEST: passed"
);
