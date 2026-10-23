// Registra solo opciones públicas necesarias para auditar el build de Hostinger.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { default: loadConfig } = require("next/dist/server/config");
const { PHASE_PRODUCTION_BUILD } = require("next/constants");
const config = await loadConfig(PHASE_PRODUCTION_BUILD, process.cwd());
const result = {
  node: process.version,
  next: require("next/package.json").version,
  cpus: config.experimental.cpus,
  resolvedPluginRuntimeStrategy: config.experimental.turbopackPluginRuntimeStrategy,
};
writeFileSync(`docs/evidence/pr512-dependencies/config-node${process.versions.node.split(".")[0]}.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
