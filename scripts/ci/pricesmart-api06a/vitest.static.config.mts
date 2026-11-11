import { defineConfig } from "vitest/config";

// Pruebas ESTÁTICAS de API-06A (guardas, DDL, reporte). No inician MariaDB ni abren conexiones.
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["scripts/ci/pricesmart-api06a/safety.test.ts", "scripts/ci/pricesmart-api06a/ddl.test.ts", "scripts/ci/pricesmart-api06a/executor.test.ts"],
    clearMocks: true,
  },
});
