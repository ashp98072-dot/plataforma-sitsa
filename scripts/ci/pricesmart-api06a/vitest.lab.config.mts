import { defineConfig } from "vitest/config";

// Solo lo usa el ejecutor del laboratorio (run-windows.mjs). No forma parte de `npm test`.
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["scripts/ci/pricesmart-api06a/mariadb-real.lab.ts"],
    setupFiles: ["./scripts/ci/pricesmart-api06a/lab-setup.ts"],
    clearMocks: true,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
