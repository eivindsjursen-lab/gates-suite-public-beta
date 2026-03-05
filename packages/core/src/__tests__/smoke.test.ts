import { describe, it, expect } from "vitest";
import * as core from "../index.js";

describe("@gates-suite/core", () => {
  it("exports a module", () => {
    expect(core).toBeDefined();
  });
});
