import { defineConfig } from "vitest/config";

// Pruebas ESTÁTICAS de API-11 (sin base de datos ni procesos).
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["scripts/ci/pricesmart-api11/*.test.ts"] },
});
