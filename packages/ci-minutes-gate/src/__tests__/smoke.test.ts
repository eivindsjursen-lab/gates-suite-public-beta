import { describe, it, expect } from "vitest";
import * as ciMinutesGate from "../index.js";

describe("@gates-suite/ci-minutes-gate", () => {
  it("exports a module", () => {
    expect(ciMinutesGate).toBeDefined();
  });
});
