import { defineConfig } from "vitest/config";

// Solo lo usa scripts/ci/portal-e2e/harness.mjs (entorno sandbox desechable). No forma parte de `npm test`.
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["scripts/ci/portal-e2e/*.e2e.ts"], testTimeout: 120000, hookTimeout: 60000 },
});
