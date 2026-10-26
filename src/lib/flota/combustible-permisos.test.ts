import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACCIONES_COMBUSTIBLE, capacidadesCombustible, puedeCombustible } from "./combustible-permisos";
import { adaptarPermisosLegacy, cambiarAccion, CATALOGO_PERMISOS, materializarAcciones, normalizarMatriz, VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import { mergePermisosConCatalogo, type PermisoModulo } from "@/lib/permisos-shared";
const p = (modulo: string, flags: Partial<PermisoModulo> = {}): PermisoModulo => ({ modulo, puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...flags });
const ver = p("flota_combustible", { puedeVer: true });
const version = p(VERSION_PERMISOS, { puedeVer: true });

describe("acciones independientes de Combustibles", () => {
  it("catálogo central ofrece exactamente ocho capacidades y filas VARCHAR(40)", () => {
    const acciones = CATALOGO_PERMISOS.find(m => m.id === "flota_combustible")!.acciones;
    expect(acciones.map(a => a.id)).toEqual([...ACCIONES_COMBUSTIBLE]);
    expect(acciones.map(a => a.label)).toEqual(["Ver", "Registrar vale", "Editar pendientes", "Revisar vales", "Conciliar", "Gestionar estaciones", "Completar documentos", "Corregir documentos declarados"]);
    expect(acciones.every(a => a.modulo.length <= 40)).toBe(true);
  });
  it.each(ACCIONES_COMBUSTIBLE)("solo Ver + %s no concede otras capacidades", accion => {
    const matriz = cambiarAccion([version, ver], "flota_combustible", accion, true);
    for (const otra of ACCIONES_COMBUSTIBLE) expect(puedeCombustible(matriz, otra)).toBe(otra === "ver" || otra === accion);
  });
  it("sin Ver ni siquiera una fila de acción aislada da acceso", () => {
    for (const a of ACCIONES_COMBUSTIBLE) expect(puedeCombustible([version, p("flota_combustible_registrar", { puedeVer: true })], a)).toBe(false);
    expect(Object.values(capacidadesCombustible([], true))).toEqual(Array(8).fill(true));
  });
  it.each([false, true])("legacy anterior/V2 (v2=%s) conserva editar en las cinco acciones", v2 => {
    const raw = [p("flota_combustible", { puedeVer: true, puedeEditar: true }), ...(v2 ? [version] : [])];
    const efectiva = adaptarPermisosLegacy(raw, "JefeOperaciones");
    expect(ACCIONES_COMBUSTIBLE.slice(0,6).every(a => puedeCombustible(efectiva,a))).toBe(true);
    expect(puedeCombustible(efectiva,"completar_documentos")).toBe(false);
    expect(puedeCombustible(efectiva,"corregir_documentos")).toBe(false);
    const editada = materializarAcciones(adaptarPermisosLegacy(mergePermisosConCatalogo("JefeOperaciones", efectiva), "JefeOperaciones"));
    const guardada = normalizarMatriz(editada);
    expect(ACCIONES_COMBUSTIBLE.slice(0,6).every(a => puedeCombustible(guardada,a))).toBe(true);
    expect(puedeCombustible(guardada,"completar_documentos")).toBe(false);
    expect(puedeCombustible(guardada,"corregir_documentos")).toBe(false);
    const revocada = normalizarMatriz(cambiarAccion(editada, "flota_combustible", "revisar", false));
    expect(revocada.find(p => p.modulo === "flota_combustible")?.puedeEditar).toBe(true);
    expect(puedeCombustible(revocada, "revisar")).toBe(false);
    expect(puedeCombustible(adaptarPermisosLegacy(revocada), "revisar")).toBe(false);
    expect(puedeCombustible(revocada, "registrar")).toBe(true);
  });
  it("legacy solo Ver/crear/eliminar no hereda nuevas acciones", () => {
    for (const flags of [{ puedeVer: true }, { puedeVer: true, puedeCrear: true }, { puedeVer: true, puedeEliminar: true }]) {
      const matriz = adaptarPermisosLegacy([p("flota_combustible", flags)]);
      expect(puedeCombustible(matriz, "ver")).toBe(true);
      for (const a of ACCIONES_COMBUSTIBLE.slice(1)) expect(puedeCombustible(matriz, a)).toBe(false);
    }
  });
  it("Solo Ver y quitar Ver limpian las acciones aunque siga existiendo editar legacy", () => {
    const legacy = [ver, p("flota_combustible", { puedeVer: true, puedeEditar: true })].slice(1);
    const quitada = cambiarAccion(legacy, "flota_combustible", "ver", false);
    for (const a of ACCIONES_COMBUSTIBLE) expect(puedeCombustible(quitada, a)).toBe(false);
  });
  it("UI conecta capacidades distintas sin quitar consulta ni catálogo activo", () => {
    const panel = readFileSync("src/components/flota/combustible-revision.tsx", "utf8");
    expect(readFileSync("src/components/flota/combustibles-client.tsx", "utf8")).toContain("capacidades.registrar && <Link");
    expect(panel).toContain("const puedeEditar = capacidades.editar_pendientes");
    expect(panel).toContain("const puedeRevisar = capacidades.revisar");
    expect(panel).toContain("{puedeEditar && <button");
    expect(panel).toContain("{puedeRevisar && <div");
    expect(panel).toContain("puedeConciliar={capacidades.conciliar}");
    expect(readFileSync("src/components/flota/combustibles-client.tsx", "utf8")).toContain("capacidades.gestionar_estaciones && <Link");
    const conciliacion = readFileSync("src/components/flota/combustible-conciliacion.tsx", "utf8");
    expect(conciliacion).toContain("{puedeConciliar && <button");
    expect(conciliacion).toContain('sub === "nueva" && puedeConciliar');
  });
});
