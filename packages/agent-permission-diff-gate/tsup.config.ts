import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/action.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  noExternal: ["@gates-suite/core"],
  tsconfig: "tsconfig.build.json",
});
