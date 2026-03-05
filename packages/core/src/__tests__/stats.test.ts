import { describe, it, expect } from "vitest";
import { median, percentile, coefficientOfVariation, deltaPct } from "../stats/median.js";

describe("median", () => {
  it("returns undefined for empty array", () => {
    expect(median([])).toBeUndefined();
  });

  it("returns the single value for one-element array", () => {
    expect(median([42])).toBe(42);
  });

  it("returns middle value for odd-length array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("returns average of two middle values for even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("handles unsorted input", () => {
    expect(median([5, 1, 3, 2, 4])).toBe(3);
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("percentile", () => {
  it("returns undefined for empty array", () => {
    expect(percentile([], 50)).toBeUndefined();
  });

  it("returns undefined for out-of-range percentile", () => {
    expect(percentile([1, 2, 3], -1)).toBeUndefined();
    expect(percentile([1, 2, 3], 101)).toBeUndefined();
  });

  it("p0 returns minimum", () => {
    expect(percentile([5, 3, 1, 4, 2], 0)).toBe(1);
  });

  it("p100 returns maximum", () => {
    expect(percentile([5, 3, 1, 4, 2], 100)).toBe(5);
  });

  it("p50 equals median", () => {
    const values = [1, 2, 3, 4, 5];
    expect(percentile(values, 50)).toBe(median(values));
  });

  it("interpolates for non-exact percentiles", () => {
    const result = percentile([10, 20, 30, 40], 90);
    expect(result).toBeDefined();
    expect(result).toBeGreaterThan(30);
    expect(result).toBeLessThanOrEqual(40);
  });
});

describe("coefficientOfVariation", () => {
  it("returns undefined for fewer than 2 values", () => {
    expect(coefficientOfVariation([])).toBeUndefined();
    expect(coefficientOfVariation([42])).toBeUndefined();
  });

  it("returns 0 for identical values", () => {
    expect(coefficientOfVariation([5, 5, 5, 5])).toBe(0);
  });

  it("returns higher CV for more variable data", () => {
    const lowVar = coefficientOfVariation([100, 101, 99, 100, 100]);
    const highVar = coefficientOfVariation([50, 150, 200, 10, 300]);
    expect(lowVar).toBeDefined();
    expect(highVar).toBeDefined();
    if (highVar !== undefined && lowVar !== undefined) {
      expect(highVar).toBeGreaterThan(lowVar);
    }
  });

  it("returns undefined when mean is zero", () => {
    expect(coefficientOfVariation([0, 0])).toBeUndefined();
  });
});

describe("deltaPct", () => {
  it("returns 0 for identical values", () => {
    expect(deltaPct(100, 100)).toBe(0);
  });

  it("returns positive for regression", () => {
    expect(deltaPct(100, 150)).toBe(50);
  });

  it("returns negative for improvement", () => {
    expect(deltaPct(200, 100)).toBe(-50);
  });

  it("returns 100 when baseline is zero and current is non-zero", () => {
    expect(deltaPct(0, 50)).toBe(100);
  });

  it("returns 0 when both are zero", () => {
    expect(deltaPct(0, 0)).toBe(0);
  });
});
