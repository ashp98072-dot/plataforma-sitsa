import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxMode, validateSandboxConfig } from "./sandbox-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const sandbox = sandboxMode();
if (sandbox) {
  // Before Next can load its own .env files, even for npm start/dev/build.
  validateSandboxConfig(process.env, root);
  // Private sandbox supports the single reviewed start path only.
  if (args.length !== 1 || args[0] !== "start") throw new Error("Sandbox solo permite start sin argumentos adicionales.");
  args.push("--hostname", "127.0.0.1");
}
const child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), ...args], {
  cwd: root, env: process.env, stdio: "inherit",
});
const interrupt = () => child.kill("SIGINT");
const terminate = () => child.kill("SIGTERM");
process.once("SIGINT", interrupt);
process.once("SIGTERM", terminate);
function cleanup() {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
}
child.on("error", () => {
  cleanup();
  console.error("No se pudo iniciar Next.");
  process.exit(1);
});
child.on("exit", (code, signal) => {
  cleanup();
  process.exit(code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1));
});
