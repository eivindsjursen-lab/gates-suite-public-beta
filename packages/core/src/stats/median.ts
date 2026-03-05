/**
 * Compute median of a numeric array. Returns undefined for empty arrays.
 */
export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid];
}

/**
 * Compute the p-th percentile (0-100) of a numeric array.
 */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0 || p < 0 || p > 100) return undefined;

  const sorted = [...values].sort((a, b) => a - b);

  if (p === 0) return sorted[0];
  if (p === 100) return sorted[sorted.length - 1];

  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const fraction = rank - lower;

  const lowerVal = sorted[lower] ?? 0;
  const upperVal = sorted[lower + 1] ?? lowerVal;

  return lowerVal + fraction * (upperVal - lowerVal);
}

/**
 * Compute coefficient of variation (std dev / mean). Higher = more variance.
 * Returns undefined for empty arrays or zero mean.
 */
export function coefficientOfVariation(values: number[]): number | undefined {
  if (values.length < 2) return undefined;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return undefined;

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / Math.abs(mean);
}

/**
 * Compute percentage delta between baseline and current values.
 */
export function deltaPct(baseline: number, current: number): number {
  if (baseline === 0) return current === 0 ? 0 : 100;
  return ((current - baseline) / baseline) * 100;
}
