import { defineConfig } from "vitest/config";

export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/lib/sandbox-isolation.test.ts", "src/lib/sandbox-startup.test.ts", "src/lib/uploads.test.ts", "src/lib/session-tokens.test.ts", "src/lib/flota/cb2/origin.test.ts", "src/lib/flota/cb2/http-origin.test.ts", "src/lib/rrhh/foto-empleado.test.ts", "src/lib/rrhh/foto-empleado-miniatura.test.ts"],
    setupFiles: ["./scripts/ci/sandbox-no-network.ts"],
    clearMocks: true,
  },
});
