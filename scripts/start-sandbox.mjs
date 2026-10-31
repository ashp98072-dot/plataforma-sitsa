import { sandboxMode, validateSandboxConfig } from "./sandbox-config.mjs";
if (!sandboxMode()) throw new Error("start:sandbox requiere NOVALVION_ENV=sandbox.");
validateSandboxConfig();
await import("./start-hostinger.mjs");
