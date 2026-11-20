import { defineConfig } from "vitest/config";

// Pruebas ESTÁTICAS del laboratorio B13 (sin base de datos ni procesos).
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["scripts/ci/tms-incidencias-b13/*.test.ts"] },
});
