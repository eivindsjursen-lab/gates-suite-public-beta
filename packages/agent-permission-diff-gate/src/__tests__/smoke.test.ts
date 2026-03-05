import { describe, it, expect } from "vitest";
import * as agentPermissionDiffGate from "../index.js";

describe("@gates-suite/agent-permission-diff-gate", () => {
  it("exports a module", () => {
    expect(agentPermissionDiffGate).toBeDefined();
  });
});
