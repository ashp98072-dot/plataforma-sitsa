import { defineConfig } from "vitest/config";
// Vite también puede leer .env sin que el código importe dotenv: desactivarlo explícitamente.
export default defineConfig({
  envDir: false,
  resolve: { tsconfigPaths: true },
  test: { environment: "node", include: ["src/**/*.test.ts"], clearMocks: true },
});
