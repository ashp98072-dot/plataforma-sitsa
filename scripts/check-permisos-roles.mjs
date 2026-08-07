/**
 * Chequeo estático de roles/menú (sin DB ni Next).
 * node scripts/check-permisos-roles.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rolesSrc = readFileSync(join(root, "src/lib/roles.ts"), "utf8");
const permisosSrc = readFileSync(
  join(root, "src/lib/permisos-shared.ts"),
  "utf8",
);
const shellSrc = readFileSync(
  join(root, "src/components/app-shell.tsx"),
  "utf8",
);
const tenantSrc = readFileSync(join(root, "src/lib/tenant.ts"), "utf8");

function caseBlock(src, caseName) {
  const re = new RegExp(
    `case "${caseName}":([\\s\\S]*?)(?:case "|default:)`,
  );
  const m = src.match(re);
  assert.ok(m, `No se encontró case ${caseName}`);
  return m[1];
}

function fnBlock(src, fnName) {
  const re = new RegExp(
    `export function ${fnName}\\([\\s\\S]*?\\n\\}`,
  );
  const m = src.match(re);
  assert.ok(m, `No se encontró function ${fnName}`);
  return m[0];
}

const prediosMods = caseBlock(rolesSrc, "CoordinadorPredios");
assert.match(prediosMods, /return \["flota"\]/);
assert.doesNotMatch(prediosMods, /"tms"/);

const opsMods = caseBlock(rolesSrc, "Operaciones");
assert.match(opsMods, /"tms"/);
assert.match(opsMods, /"flota"/);

const comprasMods = caseBlock(rolesSrc, "CoordinadorCompras");
assert.match(comprasMods, /"flota"/);
assert.doesNotMatch(comprasMods, /"tms"/);

const propiosFn = fnBlock(permisosSrc, "modulosPropiosDelRol");
const prediosPropios = caseBlock(propiosFn, "CoordinadorPredios");
assert.match(prediosPropios, /FLOTA_SUBMODULOS/);
assert.doesNotMatch(prediosPropios, /"tms"/);

const opsPropios = caseBlock(propiosFn, "Operaciones");
assert.match(opsPropios, /"tms"/);

assert.match(
  shellSrc,
  /Dashboard Operaciones solo si el usuario tiene algún módulo de ops/,
);
assert.match(tenantSrc, /esPlataformaPermisible\(modulo\)/);
assert.match(
  tenantSrc,
  /!tienePermiso\(perms, modulo, "ver"\)/,
);

// Simulación menú Operaciones
function opsModsVisibles(modulos, permisos, isAdmin, rol) {
  const ops = ["tms", "reciclaje", "tarimas"].filter((m) => {
    if (!modulos.includes(m)) return false;
    if (
      !isAdmin &&
      permisos.length > 0 &&
      !permisos.some((p) => p.modulo === m && p.puedeVer)
    ) {
      return false;
    }
    return true;
  });
  return {
    ops,
    showDash: isAdmin || rol === "Operaciones" || ops.length > 0,
  };
}

const predios = opsModsVisibles(
  ["flota"],
  [{ modulo: "flota_vehiculos", puedeVer: true }],
  false,
  "CoordinadorPredios",
);
assert.equal(predios.ops.length, 0);
assert.equal(predios.showDash, false);

const ops = opsModsVisibles(
  ["tms", "flota", "reciclaje", "tarimas"],
  [
    { modulo: "tms", puedeVer: true },
    { modulo: "reciclaje", puedeVer: true },
    { modulo: "tarimas", puedeVer: true },
  ],
  false,
  "Operaciones",
);
assert.ok(ops.ops.includes("tms"));
assert.equal(ops.showDash, true);

const opsOff = opsModsVisibles(
  ["tms", "flota"],
  [{ modulo: "tms", puedeVer: false }],
  false,
  "Operaciones",
);
assert.ok(!opsOff.ops.includes("tms"));
assert.equal(opsOff.showDash, true);

console.log("check-permisos-roles: OK");
