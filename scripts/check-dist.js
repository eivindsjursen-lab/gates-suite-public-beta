#!/usr/bin/env node

/**
 * Verify committed dist/ matches what `pnpm build` produces.
 * Used in CI to enforce the "dist committed in PRs" invariant.
 *
 * Usage: node scripts/check-dist.js [--package <name>]
 * Without --package, checks all action packages.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const ACTION_PACKAGES = [
  "packages/cache-health-gate",
  "packages/ci-minutes-gate",
  "packages/agent-permission-diff-gate",
];

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", cwd: root, ...opts }).trim();
}

const targetPkg = process.argv.includes("--package")
  ? process.argv[process.argv.indexOf("--package") + 1]
  : undefined;

const packages = targetPkg ? ACTION_PACKAGES.filter((p) => p.includes(targetPkg)) : ACTION_PACKAGES;

if (packages.length === 0) {
  console.error(`No matching package for: ${targetPkg}`);
  process.exit(1);
}

run("pnpm build");

let stale = false;

for (const pkg of packages) {
  const distPath = resolve(root, pkg, "dist");

  if (!existsSync(distPath)) {
    console.error(`FAIL: ${pkg}/dist/ does not exist after build.`);
    stale = true;
    continue;
  }

  const diff = run(`git diff --name-only -- "${pkg}/dist/"`);
  const untracked = run(`git ls-files --others --exclude-standard -- "${pkg}/dist/"`);

  if (diff || untracked) {
    console.error(`FAIL: ${pkg}/dist/ is stale.`);
    if (diff) console.error(`  Changed: ${diff.split("\n").join(", ")}`);
    if (untracked) console.error(`  Untracked: ${untracked.split("\n").join(", ")}`);
    stale = true;
  } else {
    console.log(`OK: ${pkg}/dist/ is up to date.`);
  }
}

if (stale) {
  console.error("\nRun 'pnpm build' and commit dist/ before pushing.");
  process.exit(1);
}

console.log("\nAll dist/ outputs are up to date.");
