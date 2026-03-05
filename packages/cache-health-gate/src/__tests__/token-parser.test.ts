import { describe, it, expect } from "vitest";
import {
  parseTokenFields,
  parseCacheToken,
  parseCacheStepMarker,
  extractCacheData,
} from "../parser/token-parser.js";
import type { WorkflowJob } from "@gates-suite/core";

describe("parseTokenFields", () => {
  it("parses simple key=value pairs", () => {
    const fields = parseTokenFields("group=deps hit=true key_fp=abc123");
    expect(fields.get("group")).toBe("deps");
    expect(fields.get("hit")).toBe("true");
    expect(fields.get("key_fp")).toBe("abc123");
  });

  it("handles URL-encoded values", () => {
    const fields = parseTokenFields("group=my%20deps key_fp=abc%3D123");
    expect(fields.get("group")).toBe("my deps");
    expect(fields.get("key_fp")).toBe("abc=123");
  });

  it("handles extra whitespace", () => {
    const fields = parseTokenFields("  group=deps   hit=true  ");
    expect(fields.get("group")).toBe("deps");
    expect(fields.get("hit")).toBe("true");
  });

  it("ignores entries without =", () => {
    const fields = parseTokenFields("group=deps orphan hit=true");
    expect(fields.size).toBe(2);
    expect(fields.has("orphan")).toBe(false);
  });

  it("ignores keys with invalid characters", () => {
    const fields = parseTokenFields("valid_key=yes bad-key=no bad.key=no");
    expect(fields.get("valid_key")).toBe("yes");
    expect(fields.has("bad-key")).toBe(false);
    expect(fields.has("bad.key")).toBe(false);
  });

  it("handles empty string", () => {
    expect(parseTokenFields("").size).toBe(0);
  });

  it("handles value with = inside", () => {
    const fields = parseTokenFields("group=deps key_fp=abc=def");
    expect(fields.get("key_fp")).toBe("abc=def");
  });
});

describe("parseCacheToken", () => {
  it("parses a standard cache token", () => {
    const token = parseCacheToken("[cache] group=deps hit=true key_fp=1a2b3c4d5e6f key_hint=pnpm");
    expect(token).toBeDefined();
    expect(token?.group).toBe("deps");
    expect(token?.hit).toBe(true);
    expect(token?.keyFp).toBe("1a2b3c4d5e6f");
    expect(token?.keyHint).toBe("pnpm");
  });

  it("parses hit=false", () => {
    const token = parseCacheToken("[cache] group=deps hit=false key_fp=abc");
    expect(token?.hit).toBe(false);
  });

  it("treats missing hit as false", () => {
    const token = parseCacheToken("[cache] group=deps key_fp=abc");
    expect(token?.hit).toBe(false);
  });

  it("returns undefined for missing group", () => {
    expect(parseCacheToken("[cache] hit=true key_fp=abc")).toBeUndefined();
  });

  it("returns undefined for missing key_fp", () => {
    expect(parseCacheToken("[cache] group=deps hit=true")).toBeUndefined();
  });

  it("returns undefined for non-cache steps", () => {
    expect(parseCacheToken("Run tests")).toBeUndefined();
    expect(parseCacheToken("[cache-step] group=deps")).toBeUndefined();
    expect(parseCacheToken("")).toBeUndefined();
  });

  it("handles leading/trailing whitespace", () => {
    const token = parseCacheToken("  [cache] group=deps key_fp=abc  ");
    expect(token?.group).toBe("deps");
  });

  it("key_hint is optional", () => {
    const token = parseCacheToken("[cache] group=deps key_fp=abc");
    expect(token?.keyHint).toBeUndefined();
  });
});

describe("parseCacheStepMarker", () => {
  it("parses a standard cache-step marker", () => {
    const marker = parseCacheStepMarker(
      "[cache-step] group=deps",
      "build",
      3,
      "2026-02-01T00:00:00Z",
      "2026-02-01T00:01:00Z",
    );
    expect(marker).toBeDefined();
    expect(marker?.group).toBe("deps");
    expect(marker?.jobName).toBe("build");
    expect(marker?.stepIndex).toBe(3);
  });

  it("returns undefined for missing group", () => {
    expect(parseCacheStepMarker("[cache-step]", "build", 1, null, null)).toBeUndefined();
  });

  it("returns undefined for non-cache-step names", () => {
    expect(parseCacheStepMarker("[cache] group=deps", "build", 1, null, null)).toBeUndefined();
    expect(parseCacheStepMarker("Run tests", "build", 1, null, null)).toBeUndefined();
  });
});

describe("extractCacheData", () => {
  function makeJob(name: string, steps: { name: string; number: number }[]): WorkflowJob {
    return {
      id: 1,
      run_id: 1,
      name,
      status: "completed",
      conclusion: "success",
      started_at: "2026-02-01T00:00:00Z",
      completed_at: "2026-02-01T00:05:00Z",
      steps: steps.map((s) => ({
        ...s,
        status: "completed",
        conclusion: "success",
        started_at: "2026-02-01T00:00:00Z",
        completed_at: "2026-02-01T00:01:00Z",
      })),
    };
  }

  it("extracts tokens and markers from jobs", () => {
    const jobs = [
      makeJob("build", [
        { name: "[cache-step] group=deps", number: 1 },
        { name: "[cache] group=deps hit=true key_fp=abc123", number: 2 },
        { name: "Run tests", number: 3 },
      ]),
    ];

    const { tokens, markers } = extractCacheData(jobs);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.group).toBe("deps");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.group).toBe("deps");
    expect(tokens[0]?.jobName).toBe("build");
  });

  it("handles multiple groups across jobs", () => {
    const jobs = [
      makeJob("test", [
        { name: "[cache-step] group=deps", number: 1 },
        { name: "[cache] group=deps hit=true key_fp=abc", number: 2 },
        { name: "[cache-step] group=build_cache", number: 3 },
        { name: "[cache] group=build_cache hit=false key_fp=def", number: 4 },
      ]),
    ];

    const { tokens, markers } = extractCacheData(jobs);
    expect(markers).toHaveLength(2);
    expect(tokens).toHaveLength(2);
  });

  it("handles jobs without steps", () => {
    const jobs: WorkflowJob[] = [
      {
        id: 1,
        run_id: 1,
        name: "empty",
        status: "completed",
        conclusion: "success",
        started_at: null,
        completed_at: null,
      },
    ];

    const { tokens, markers } = extractCacheData(jobs);
    expect(tokens).toHaveLength(0);
    expect(markers).toHaveLength(0);
  });
});

describe("fuzz: token parser robustness", () => {
  const fuzzInputs = [
    "",
    " ",
    "[cache]",
    "[cache] ",
    "[cache] group=",
    "[cache] =value",
    "[cache] group=deps key_fp=",
    "[cache] group= key_fp=abc",
    "[cache] group=deps hit=true key_fp=abc extra_field=ignored",
    `[cache] group=${"a".repeat(500)} key_fp=abc`,
    "[cache] group=deps\nhit=true\nkey_fp=abc",
    "[cache] group=deps\thit=true\tkey_fp=abc",
    "[cache] group=d%C3%A9ps key_fp=abc",
    "[cache] group=deps hit=TRUE key_fp=abc",
    "[cache] group=deps hit=1 key_fp=abc",
    "[cache] group=deps hit=yes key_fp=abc",
    "[CACHE] group=deps key_fp=abc",
    "  [cache]   group=deps   key_fp=abc  ",
    "[cache] group=deps key_fp=abc key_fp=def",
    "[cache] group=a%00b key_fp=abc",
    "[cache] group=deps key_fp=%E2%9C%85",
    "[cache] group=deps key_fp=abc\x00def",
  ];

  it.each(fuzzInputs)("does not throw on input: %j", (input) => {
    expect(() => parseCacheToken(input)).not.toThrow();
  });

  it("handles unicode in group names via URL encoding", () => {
    const token = parseCacheToken("[cache] group=d%C3%A9ps key_fp=abc");
    expect(token?.group).toBe("déps");
  });

  it("handles very long step names", () => {
    const longGroup = "a".repeat(500);
    const token = parseCacheToken(`[cache] group=${longGroup} key_fp=abc`);
    expect(token?.group).toBe(longGroup);
  });

  it("tab-separated fields are parsed tolerantly", () => {
    const token = parseCacheToken("[cache] group=deps\thit=true\tkey_fp=abc");
    expect(token?.group).toBe("deps");
  });

  it("last value wins for duplicate keys", () => {
    const fields = parseTokenFields("group=first group=second");
    expect(fields.get("group")).toBe("second");
  });

  const fuzzMarkerInputs = [
    "",
    "[cache-step]",
    "[cache-step] ",
    "[cache-step] group=",
    `[cache-step] group=${"x".repeat(300)}`,
    "[cache-step] group=deps extra=stuff",
  ];

  it.each(fuzzMarkerInputs)("cache-step marker does not throw on: %j", (input) => {
    expect(() => parseCacheStepMarker(input, "job", 1, null, null)).not.toThrow();
  });
});
