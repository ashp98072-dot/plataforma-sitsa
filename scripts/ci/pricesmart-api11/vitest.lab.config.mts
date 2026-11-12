import { defineConfig } from "vitest/config";

// Solo lo usa el ejecutor del laboratorio API-11 (run-windows.mjs). No forma parte de `npm test`.
// Reutiliza (sin modificar) la guardia de red del laboratorio B12: la única conexión permitida es el pipe administrativo del run o 127.0.0.1:<puerto del run>.
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["scripts/ci/pricesmart-api11/api11.lab.ts"],
    setupFiles: ["./scripts/ci/pricesmart-api06a/lab-setup.ts"],
    clearMocks: true,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
