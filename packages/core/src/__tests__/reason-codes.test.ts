import { describe, it, expect } from "vitest";
import {
  PASS_ALL_CLEAR,
  SKIP_NO_BASELINE,
  WARN_LOW_CONFIDENCE,
  FAIL_RESTORE_REGRESSION,
  lookupReasonCode,
  getReasonMessage,
  isValidReasonCode,
  allReasonCodes,
  validateReasonCodePrefix,
} from "../index.js";

describe("reason code entries", () => {
  it("PASS_ALL_CLEAR has correct structure", () => {
    expect(PASS_ALL_CLEAR.code).toBe("PASS_ALL_CLEAR");
    expect(PASS_ALL_CLEAR.severity).toBe("pass");
    expect(PASS_ALL_CLEAR.message).toBeTruthy();
  });

  it("SKIP_NO_BASELINE has correct structure", () => {
    expect(SKIP_NO_BASELINE.code).toBe("SKIP_NO_BASELINE");
    expect(SKIP_NO_BASELINE.severity).toBe("skip");
  });

  it("WARN_LOW_CONFIDENCE has correct structure", () => {
    expect(WARN_LOW_CONFIDENCE.code).toBe("WARN_LOW_CONFIDENCE");
    expect(WARN_LOW_CONFIDENCE.severity).toBe("warn");
  });

  it("FAIL_RESTORE_REGRESSION has correct structure", () => {
    expect(FAIL_RESTORE_REGRESSION.code).toBe("FAIL_RESTORE_REGRESSION");
    expect(FAIL_RESTORE_REGRESSION.severity).toBe("fail");
  });
});

describe("all reason codes follow naming convention", () => {
  it("every code matches UPPER_SNAKE_CASE with valid prefix", () => {
    const codes = allReasonCodes();
    expect(codes.size).toBeGreaterThan(0);

    for (const [code, entry] of codes) {
      expect(code).toBe(entry.code);
      expect(validateReasonCodePrefix(code)).toBe(true);
    }
  });

  it("severity matches prefix", () => {
    const prefixMap: Record<string, string> = {
      PASS: "pass",
      WARN: "warn",
      FAIL: "fail",
      SKIP: "skip",
    };

    for (const [, entry] of allReasonCodes()) {
      const prefix = entry.code.split("_")[0] ?? "";
      expect(entry.severity).toBe(prefixMap[prefix]);
    }
  });

  it("every code has a non-empty prescriptive message", () => {
    for (const [, entry] of allReasonCodes()) {
      expect(entry.message.length).toBeGreaterThan(10);
    }
  });
});

describe("lookupReasonCode", () => {
  it("finds known codes", () => {
    const entry = lookupReasonCode("PASS_ALL_CLEAR");
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe("pass");
  });

  it("returns undefined for unknown codes", () => {
    expect(lookupReasonCode("UNKNOWN_CODE")).toBeUndefined();
  });
});

describe("getReasonMessage", () => {
  it("returns message for known codes", () => {
    const msg = getReasonMessage("SKIP_NO_BASELINE");
    expect(msg).toContain("baseline");
  });

  it("returns fallback for unknown codes", () => {
    const msg = getReasonMessage("FAKE_CODE");
    expect(msg).toContain("Unknown reason code");
  });
});

describe("isValidReasonCode", () => {
  it("returns true for registered codes", () => {
    expect(isValidReasonCode("PASS_ALL_CLEAR")).toBe(true);
    expect(isValidReasonCode("FAIL_CAPABILITY_ESCALATION")).toBe(true);
  });

  it("returns false for unregistered codes", () => {
    expect(isValidReasonCode("INVALID")).toBe(false);
  });
});

describe("validateReasonCodePrefix", () => {
  it("accepts valid formats", () => {
    expect(validateReasonCodePrefix("PASS_ALL_CLEAR")).toBe(true);
    expect(validateReasonCodePrefix("WARN_LOW_CONFIDENCE")).toBe(true);
    expect(validateReasonCodePrefix("FAIL_RESTORE_REGRESSION")).toBe(true);
    expect(validateReasonCodePrefix("SKIP_NO_BASELINE")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(validateReasonCodePrefix("pass_all_clear")).toBe(false);
    expect(validateReasonCodePrefix("ERROR_SOMETHING")).toBe(false);
    expect(validateReasonCodePrefix("PASS")).toBe(false);
    expect(validateReasonCodePrefix("")).toBe(false);
  });
});
