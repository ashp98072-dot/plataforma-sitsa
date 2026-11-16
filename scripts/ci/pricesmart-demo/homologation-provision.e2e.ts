// PRICESMART-API-26 — ENSAYO del paquete de aprovisionamiento del sandbox de homologación contra MariaDB 11.8.9 desechable. `demo.mjs rehearse-homologation` EJECUTÓ el paquete (esquema aparte
// `sandbox_api02_homolog_r1`, cuentas reales por TCP) y dejó su informe; aquí se AUDITA ese informe. Nada se ejecuta contra ningún otro servidor. Solo se ejecuta desde demo.mjs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_PRIVILEGE_POLICY, auditRoleGrants } from "../../../src/lib/integrations/pricesmart/grants-audit";

const report = JSON.parse(readFileSync(path.join(String(process.env.PS_DEMO_RUNDIR), "homolog-rehearsal.json"), "utf8")) as Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const denied = (v: unknown) => typeof v === "number" && [1044, 1045, 1142, 1143, 1227, 1370, 1410].includes(v);   // errores de PRIVILEGIOS del motor (no de datos)

describe("API-26 ensayo del aprovisionamiento (MariaDB real)", () => {
  it("P1 el paquete crea la base como sandbox identificado, con las tablas de PriceSmart, y no deja contraseñas en la sesión", () => {
    expect(report.names).toMatchObject({ schema: "sandbox_api02_homolog_r1", sandboxId: "homolog-r1" });
    expect(report.environmentRow).toEqual({ environment: "sandbox", sandbox_id: "homolog-r1" });
    expect(report.tables).toEqual(expect.arrayContaining(["novalvion_environment", "ps_api01_orders", "ps_api01_events", "ps_api01_outbox", "ps_api01_audit", "ps_api11_integrations", "ps_api11_revocations", "ps_api11_rate_counters", "ps_api11_proof_claims",
      "ps_api12_tms_links", "ps_api12_tms_mapping", "ps_api13_link_jobs", "ps_api13_link_attempts", "ps_api18_attestation_nonces", "ps_api18_resource_registry"]));
    expect((report.tables as string[]).filter((t) => t.startsWith("ps_api") || t === "novalvion_environment")).toHaveLength(16); expect(report.applied).toMatchObject({ schema: "sandbox_api02_homolog_r1", tables: 15 });
    // Esquema del TMS (archivos SQL) + «esquema de ejecución» del proyecto con el MISMO entorno del sandbox (validateSandboxConfig) y privilegios temporales ya revocados.
    expect(report.tables).toEqual(expect.arrayContaining(["tms_solicitudes_cliente", "tms_solicitud_paradas", "tms_planes_viaje", "tms_plan_paradas", "tms_parada_confirmaciones", "auditoria"]));
    expect(report.runtimeSchemaStep.exit).toBe(0); expect(report.ensuredGrants).toBeGreaterThan(0);
    expect(report.passwordVariablesCleared).toEqual({ a: null, w: null, m: null });
  });
  it("P2 BARRERA: aplicar el paquete otra vez FALLA (la base ya existe, ER_DB_CREATE_EXISTS 1007); nada se sobrescribe", () => { expect(report.secondApply).toBe(1007); });
  it("P3 cuentas REALES y distintas por rol; la de la aplicación pasa la auditoría de privilegios mínimos del runtime (API-20) sobre sus tablas de PriceSmart; ninguna tiene privilegios globales, DELETE, DDL ni GRANT OPTION", () => {
    for (const role of ["app", "worker", "monitor"]) {
      const lines = report.grants[role] as string[]; expect(lines.length, role).toBeGreaterThan(1);
      for (const l of lines) { expect(l, `${role}: ${l}`).not.toMatch(/GRANT OPTION|\bDELETE\b|\bDROP\b|\bALTER\b|\bCREATE\b|\bFILE\b|\bSUPER\b|ALL PRIVILEGES/); if (/ ON \*\.\* /.test(l)) expect(l).toMatch(/^GRANT USAGE ON \*\.\* TO /); expect(l).toMatch(/(USAGE ON \*\.\*|ON `sandbox_api02_homolog_r1`\.`[a-z0-9_]+`) TO /); }   // lo único global es USAGE (sin privilegios)
    }
    const tables = Object.keys(RUNTIME_PRIVILEGE_POLICY);
    const appPolicyLines = (report.grants.app as string[]).filter((l) => /USAGE ON \*\.\*/.test(l) || tables.some((t) => l.includes(`\`${t}\``)));
    expect(auditRoleGrants("runtime", appPolicyLines, { schema: "sandbox_api02_homolog_r1" })).toMatchObject({ ok: true, complete: true, findings: [] });
    expect(new Set([report.names.appUser, report.names.workerUser, report.names.monitorUser]).size).toBe(3);
  });
  it("P4 MONITOR: sus consultas de vigilancia funcionan y todo lo demás (escribir, leer órdenes/cargas/catálogo) está DENEGADO por el motor", () => {
    for (const [id, v] of Object.entries(report.monitor.queries)) expect(v, id).toBe("OK");
    for (const [id, v] of Object.entries(report.monitor.forbidden)) expect(denied(v), `${id}: ${String(v)}`).toBe(true);
  });
  it("P5 WORKER: lee y actualiza SOLO las columnas de la cola; no lee la carga cifrada, no inserta ni borra, no ve el catálogo ni el vínculo TMS, no altera el esquema", () => {
    expect(report.worker.allowed).toEqual({ readOutbox: "OK", updateOutboxColumns: "OK" });
    for (const [id, v] of Object.entries(report.worker.forbidden)) expect(denied(v), `${id}: ${String(v)}`).toBe(true);
  });
  it("P6 APLICACIÓN: no borra, no altera la cola, no escribe revocaciones ni el catálogo, no cambia el esquema, no lee cuentas del servidor y la auditoría es solo de inserción", () => {
    expect(report.app.allowed).toEqual({ readEnv: "OK", readIntegrations: "OK" });
    for (const [id, v] of Object.entries(report.app.forbidden)) expect(denied(v), `${id}: ${String(v)}`).toBe(true);
  });
  it("P7 alta y revocación de una credencial con las funciones del paquete (cuenta administrativa), con datos sintéticos que aporta el operador", () => { expect(report.catalog).toEqual({ integrations: 1, revocations: 1 }); });
  it("P8 DESTRUCCIÓN: la baja elimina la base y las tres cuentas, y NO toca el esquema del laboratorio", () => { expect(report.destroyed).toEqual({ schemas: 0, accounts: 0, labSchemaIntact: 1 }); });
});
