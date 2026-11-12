import { defineConfig } from "vitest/config";

// Solo lo usa scripts/ci/pricesmart-demo/demo.mjs (entorno sandbox desechable). No forma parte de `npm test`.
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["scripts/ci/pricesmart-demo/*.e2e.ts"], testTimeout: 120000, hookTimeout: 60000, fileParallelism: false },
});
