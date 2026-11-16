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
    expect((report.tables as string[]).filter((t) => t.startsWith("ps_api") || t === "novalvion_environment")).toHaveLength(16); expect(report.applied).toMatchObject({ schema: "sandbox_api02_homolog_r1", tables: 15, state: "APPLIED" });   // «aplicado» (bootstrap) NO es «completo»: falta finalize
    for (const f of report.applied.tmsSchema) expect(f.blocking, f.file).toBe(0);   // en `apply` solo pueden quedar DIFERIDAS sentencias que dependen de fases posteriores
    expect(report.applied.complete).toBe(false);
    // Esquema del TMS (archivos SQL) + «esquema de ejecución» del proyecto con el MISMO entorno del sandbox (validateSandboxConfig) y privilegios temporales ya revocados.
    expect(report.tables).toEqual(expect.arrayContaining(["tms_solicitudes_cliente", "tms_solicitud_paradas", "tms_planes_viaje", "tms_plan_paradas", "tms_parada_confirmaciones", "auditoria"]));
    expect(report.runtimeSchemaStep.exit).toBe(0); expect(report.ensuredGrants).toBeGreaterThan(0);
    expect(report.passwordVariablesCleared).toEqual({ a: null, w: null, m: null });
  });
  it("P2 BARRERA: aplicar el paquete otra vez FALLA con STATE_NOT_ABSENT (el preflight lo detecta antes de escribir nada); nada se sobrescribe", () => { expect(report.secondApply).toBe("STATE_NOT_ABSENT"); });
  it("P2b COMPLETO ≠ aplicado: tras `finalize` el esquema de ejecución y TODAS las migraciones del proyecto quedan sin sentencias pendientes (los `USE` de otras bases se omiten) y el estado es COMPLETE con ambos marcadores", () => {
    for (const f of [...report.migrations.base, ...report.migrations.migrations, ...report.migrations.confirmations]) expect(f.pendingAtEnd, f.file).toBe(0);
    expect(report.scope.excludedFiles.length).toBeGreaterThan(0); expect(report.scope.excludedFiles.every((x: { module: string }) => x.module)).toBe(true);   // el alcance (módulos NO instalados) queda declarado en el informe
    expect(report.migrations.migrations.some((f: { skippedUse: number }) => f.skippedUse > 0)).toBe(true);   // al menos un archivo del proyecto trae `USE <otra base>`: se omitió, no se ejecutó
    expect(report.finalState).toMatchObject({ state: "COMPLETE", marker: expect.arrayContaining([{ step: "bootstrap", state: "COMPLETE" }, { step: "finalize", state: "COMPLETE" }, { step: "account:app", state: "COMPLETE" }, { step: "account:worker", state: "COMPLETE" }, { step: "account:monitor", state: "COMPLETE" }]) });
  });
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
  it("P9 AISLAMIENTO: aplicar, finalizar y destruir el sandbox NO cambió nada ajeno: una base y una cuenta señuelo (y las del laboratorio) quedaron idénticas (privilegios, sumas de verificación, tablas)", () => {
    expect(report.isolation.changed, JSON.stringify(report.isolation.changed)).toEqual([]); expect(report.isolation).toMatchObject({ unchanged: true, decoyIntact: true });
    expect(report.isolation.usersChecked).toEqual(expect.arrayContaining(["sandbox_api02_homolog_decoy"])); expect(report.isolation.usersChecked.length).toBeGreaterThanOrEqual(2);   // el señuelo y al menos una cuenta del laboratorio
    expect(report.isolation.schemasChecked).toEqual(expect.arrayContaining(["sandbox_api02_homolog_decoy"]));
  });
  it("P10 FALLO REAL de DDL del esquema del TMS (sentencia que el motor rechaza): NO se informa éxito; no hay DDL de PriceSmart, cuentas ni privilegios; diagnóstico seguro; marcador FAILED; reaplicar y finalizar se rechazan; destroy + apply limpio recupera", () => {
    const f = report.failures.tmsIncomplete;
    expect(f.result).toMatchObject({ threw: true, name: "ProvisioningError", code: "TMS_SCHEMA_INCOMPLETE", diagnostic: { phase: "base" } });
    expect(f.result.diagnostic.files[0]).toMatchObject({ file: "sql/broken.sql", applied: 1, pendingAtEnd: 1, blocking: 1 }); expect(f.result.diagnostic.files[0].failures[0].statement).toMatch(/^CREATE TABLE bad_t/); expect(f.result.diagnostic.files[0].failures[0].code).toBe("ER_INVALID_DEFAULT");
    expect(JSON.stringify(f.result.diagnostic)).not.toMatch(/password|IDENTIFIED|@ps_|sandbox:homolog/i);
    expect(f.after).toMatchObject({ state: "BOOTSTRAP_PARTIAL", accounts: 0, marker: [{ step: "bootstrap", state: "FAILED", detail: "TMS_SCHEMA_INCOMPLETE" }] });   // PARCIAL: la base y lo ya creado siguen ahí (no hay reversión del DDL)
    expect(f.after.tables).toBeGreaterThanOrEqual(2);
    expect(f.reapply).toMatchObject({ threw: true, code: "STATE_NOT_ABSENT" }); expect(f.finalize).toMatchObject({ threw: true, code: "STATE_NOT_APPLIED" });
    expect(f.destroyed.state).toBe("ABSENT"); expect(f.recovered.threw).toBe(false); expect(f.recoveredState.state).toBe("APPLIED");
  });
  it("P10b DIFERIDA ≠ COMPLETA: una sentencia que depende de una fase posterior se informa en `apply` (APPLIED, complete=false), pero `finalize` la RECHAZA (TMS_SCHEMA_INCOMPLETE), no deja privilegios sobre el esquema y el estado queda FINALIZE_FAILED", () => {
    const f = report.failures.deferred; expect(f.applied.threw).toBe(false);
    expect(f.report).toMatchObject({ state: "APPLIED", complete: false }); expect(f.report.tmsSchema.find((x: { file: string }) => x.file === "sql/deferred.sql")).toMatchObject({ pendingAtEnd: 1, deferred: 1, blocking: 0 }); expect(f.afterApply.state).toBe("APPLIED");
    expect(f.finalize).toMatchObject({ threw: true, code: "TMS_SCHEMA_INCOMPLETE", diagnostic: { phase: "base", allowDeferred: false } }); expect(f.afterFinalize.state).toBe("FINALIZE_FAILED");
    expect(f.privilegesTmp).toBe(0);   // ningún privilegio a nivel de esquema (ni temporal ni final) sobrevive
  });
  it("P13 `destroy` exige PROPIEDAD y PROCEDENCIA (MariaDB real): propio → se destruye; base ajena con nombre coincidente (sin comentario, de otro sandbox o con identidad distinta) → DESTROY_REFUSED y nada cambia (ni la base, ni sus datos, ni las cuentas ajenas homónimas)", () => {
    const o = report.ownership;
    expect(o.own.before).toMatchObject({ state: "APPLIED", schema: 1, accounts: 3 }); expect(o.own.result.threw).toBe(false); expect(o.own.report).toMatchObject({ accounts: ["app", "worker", "monitor"], schema: true, state: "ABSENT" }); expect(o.own.after).toMatchObject({ state: "ABSENT", schema: 0, accounts: 0 });
    for (const k of ["foreignNoMarker", "otherComment", "otherIdentity"]) { expect(o[k].result, k).toMatchObject({ threw: true, code: "DESTROY_REFUSED", diagnostic: { refused: "FOREIGN" } }); expect(o[k].after, k).toEqual(o[k].before); expect(o[k].before.state).toBe("FOREIGN"); }
    expect(o.foreignNoMarker.before.accounts).toBe(2);   // las cuentas ajenas con los MISMOS nombres siguen ahí
    expect(o.foreignNoMarker.apply).toMatchObject({ threw: true, code: "STATE_NOT_ABSENT", diagnostic: { state: "FOREIGN" } });   // y `apply` tampoco las pisa
  });
  it("P14 recuperación segura: fallo antes de los marcadores (solo comentario de propiedad) se recupera; con una cuenta SIN procedencia o con privilegios fuera del sandbox se DETIENE sin ningún DROP; cuentas huérfanas (sin base) se detienen; al corregir, procede", () => {
    const o = report.ownership;
    expect(o.beforeMarkers.state).toBe("BOOTSTRAP_PARTIAL"); expect(o.beforeMarkers.result.threw).toBe(false); expect(o.beforeMarkers.after).toMatchObject({ state: "ABSENT", schema: 0 });
    expect(o.beforeMarkersForeignAccount.result).toMatchObject({ threw: true, code: "DESTROY_REFUSED", diagnostic: { refused: "ACCOUNT_PROVENANCE" } }); expect(o.beforeMarkersForeignAccount.after).toEqual(o.beforeMarkersForeignAccount.before); expect(o.beforeMarkersForeignAccount.after).toMatchObject({ schema: 1, accounts: 1 });
    expect(o.grantsOutside.result).toMatchObject({ threw: true, code: "DESTROY_REFUSED", diagnostic: { refused: "ACCOUNT_PROVENANCE" } }); expect(o.grantsOutside.after).toEqual(o.grantsOutside.before); expect(o.grantsOutside.afterFix.threw).toBe(false); expect(o.grantsOutside.final).toMatchObject({ state: "ABSENT", schema: 0, accounts: 0 });
    expect(o.orphans.result).toMatchObject({ threw: true, code: "DESTROY_REFUSED", diagnostic: { refused: "ORPHAN_ACCOUNTS" } }); expect(o.orphans.after).toEqual(o.orphans.before); expect(o.orphans.before).toMatchObject({ schema: 0, accounts: 3 }); expect(o.orphans.apply).toMatchObject({ threw: true, code: "STATE_NOT_ABSENT", diagnostic: { state: "ORPHAN_ACCOUNTS" } });
  });
  it("P15 destrucción INTERRUMPIDA y repetida: con cuentas ya eliminadas se reanuda y termina; repetir la baja sobre un sandbox ausente no hace nada; el señuelo y las cuentas del laboratorio no cambiaron", () => {
    const o = report.ownership; expect(o.interrupted.before).toMatchObject({ state: "APPLIED", accounts: 1 }); expect(o.interrupted.result.threw).toBe(false); expect(o.interrupted.report).toMatchObject({ accounts: ["monitor"], schema: true }); expect(o.interrupted.after).toMatchObject({ state: "ABSENT", schema: 0, accounts: 0 });
    expect(o.repeated.first.threw).toBe(false); expect(o.repeated.second.threw).toBe(false); expect(o.repeated.secondReport).toMatchObject({ state: "ABSENT", schema: false, accounts: [] });
    expect(o.decoyIntact.checksum).toBe(true);
  });
  it("P11 FALLO REAL de DDL de PriceSmart a mitad del paquete: error del motor relanzado, instalación PARCIAL con tablas ya creadas, sin cuentas ni privilegios, marcador FAILED, reaplicar rechazado; destroy deja AUSENTE", () => {
    const f = report.failures.ddlFailure;
    expect(f.result.threw).toBe(true); expect(f.result.code).not.toBe("TMS_SCHEMA_INCOMPLETE"); expect(String(f.result.code)).toMatch(/^ER_|^\d+$/);
    expect(f.after).toMatchObject({ state: "BOOTSTRAP_PARTIAL", accounts: 0, marker: [{ step: "bootstrap", state: "FAILED" }] }); expect(f.after.tables).toBeGreaterThanOrEqual(8);   // novalvion_environment + marcador + tablas ya creadas: NO hay reversión
    expect(f.reapply).toMatchObject({ threw: true, code: "STATE_NOT_ABSENT" }); expect(f.destroyed).toMatchObject({ state: "ABSENT", accounts: 0, tables: 0 });
  });
  it("P12 FALLOS REALES en `finalize`: privilegios temporales revocados y ninguno final concedido (paso fallido y migración incompleta); estado FINALIZE_FAILED con marcador FAILED; la recuperación real completa; después se rechaza reejecutar", () => {
    const f = report.failures.finalize; expect(f.stateBefore).toBe("APPLIED");
    expect(f.stepFails.result).toMatchObject({ threw: true, code: "RUNTIME_SCHEMA_STEP_FAILED" }); expect(f.stepFails.privileges).toEqual({ schemaWide: false, ensuredTable: false }); expect(f.stepFails.after).toMatchObject({ state: "FINALIZE_FAILED", marker: expect.arrayContaining([{ step: "finalize", state: "FAILED", detail: "RUNTIME_SCHEMA_STEP_FAILED" }]) });
    expect(f.migrationsIncomplete.result).toMatchObject({ threw: true, code: "TMS_SCHEMA_INCOMPLETE", diagnostic: { phase: "confirmations" } }); expect(f.migrationsIncomplete.privileges).toEqual({ schemaWide: false, ensuredTable: false }); expect(f.migrationsIncomplete.after.state).toBe("FINALIZE_FAILED");
    expect(f.recovered.result.threw).toBe(false); expect(f.recovered.privileges).toEqual({ schemaWide: false, ensuredTable: true }); expect(f.recovered.after).toMatchObject({ state: "COMPLETE" });
    expect(f.reapplyAfterComplete).toMatchObject({ threw: true, code: "STATE_NOT_APPLIED" }); expect(f.destroyed).toMatchObject({ state: "ABSENT", accounts: 0, tables: 0 });
  });
  it("P8 DESTRUCCIÓN: la baja elimina la base y las tres cuentas, y NO toca el esquema del laboratorio", () => { expect(report.destroyed).toEqual({ schemas: 0, accounts: 0, labSchemaIntact: 1 }); });
});
