import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const m = await import("./vacaciones-bd-memoria.testutil");
  return {
    query: (sql: string, params?: unknown[]) => m.bd.consulta(sql, params as never),
    getPool: () => ({ getConnection: async () => m.bd.conexion() }),
    execute: async () => { throw new Error("no usar execute del pool"); },
  };
});
// Cualquier helper de borrado físico de archivos debe quedar sin invocar
const fisico = vi.hoisted(() => ({ borrarUpload: vi.fn(), borrarArchivosFisicos: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ borrarUpload: fisico.borrarUpload }));
vi.mock("@/lib/admin/limpiar-archivos", () => ({ borrarArchivosFisicos: fisico.borrarArchivosFisicos }));

import {
  ErrorAplicacion,
  aplicarReconstruccion,
  fraseConfirmacion,
  nombresRespaldo,
  simularReconstruccion,
  type DepsAplicador,
} from "./vacaciones-reconstruccion-aplicador";
import { cargarFuente, claveLogicaVacacion, planificarReconstruccion, resolverRelinks } from "./vacaciones-reconstruccion-plan";
import { bd, EMPRESA, escenarioAlvaro, escenarioBase, type IncidenciaRow, type Tablas } from "./vacaciones-bd-memoria.testutil";
import type { Consulta } from "./vacaciones-historial-actual";

const HOY = new Date(2026, 9, 7);
const SELLO = "202610071200";
const deps: DepsAplicador = { obtenerConexion: async () => bd.conexion() as never, consultaPool: bd.consulta as unknown as Consulta, ahora: () => HOY };
const confirmacion = (huella: string, sello = SELLO) => ({ empresaId: EMPRESA, frase: fraseConfirmacion(EMPRESA), huellaFuente: huella, sello, usuario: "admin.rrhh" });
const dry = (decisiones?: unknown) => simularReconstruccion(EMPRESA, decisiones, deps);
async function aplicar(decisiones?: unknown, sello = SELLO) {
  const d = await dry(decisiones);
  return aplicarReconstruccion({ empresaId: EMPRESA, decisiones, confirmacion: confirmacion(d.huellaFuente, sello) }, deps);
}
const claveDe = (i: IncidenciaRow) => claveLogicaVacacion(i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles);
const sinAuditoria = (t: Tablas) => ({ ...t, auditoria: [] });

beforeEach(() => {
  vi.clearAllMocks();
  bd.reiniciar(escenarioBase());
});

describe("dry-run (SOLO lectura)", () => {
  it("informa 13 vacaciones / 13 incidencias nuevas / 13 evidencias a relinkear y es aplicable; no escribe nada", async () => {
    const antes = bd.instantanea();
    const r = await dry();
    expect(r.modo).toBe("DRY_RUN");
    expect(r.escribio).toBe(false);
    expect(r.resumen).toMatchObject({ vacacionesAReconstruir: 13, incidenciasNuevasEsperadas: 13, evidenciasARelinkear: 13, evidenciasRelinkeables: 13, erroresRelink: 0, decisionesPendientes: 0 });
    expect(r.puedeAplicarse).toBe(true);
    expect(r.bloqueos).toEqual([]);
    expect(r.saldoFinalPorEmpleado.map((e) => e.codigo)).toEqual(["E-1", "E-2", "E-3", "E-4"]);
    expect(r.omitidos.map((o) => o.nombre)).toEqual(["Elisa Jiménez López"]);
    expect(bd.instantanea()).toEqual(antes);
    expect(Object.keys(bd.backups)).toEqual([]);
    expect(bd.ejecutadas.every((s) => /^SELECT/i.test(s))).toBe(true);
    expect(bd.eventos).toEqual([]); // sin transacción
  });

  it("no incluye las evidencias de otro tipo de incidencia en el alcance", async () => {
    const r = await dry();
    expect(r.resumen.evidenciasARelinkear).toBe(13); // la evidencia del «Permiso con goce» no cuenta
  });
});

describe("aplicador: relink de evidencias preservando todo", () => {
  it("13 evidencias / 13 incidencias: cada evidencia vuelve apuntando a EXACTAMENTE una incidencia nueva con su misma identidad lógica", async () => {
    const antesEv = bd.instantanea().evidencias.filter((e) => e.id !== 90002);
    const antesInc = new Map(bd.instantanea().incidencias.map((i) => [i.id, i]));
    expect(antesEv).toHaveLength(13);
    const r = await aplicar();
    expect(r).toMatchObject({ ok: true, vacaciones: 13, incidencias: 13, evidenciasRelinkeadas: 13, empleados: 4 });
    const t = bd.instantanea();
    expect(t.evidencias.filter((e) => e.id !== 90002)).toHaveLength(13); // 13 antes = 13 después
    const nuevas = new Map(t.incidencias.map((i) => [i.id, i]));
    const usadas = new Set<number>();
    for (const e0 of antesEv) {
      const e1 = t.evidencias.find((x) => x.id === e0.id)!;
      expect(e1).toBeTruthy();
      expect(e1.incidencia_id).not.toBe(e0.incidencia_id); // apunta a una incidencia NUEVA
      expect(antesInc.has(e1.incidencia_id)).toBe(false);
      expect(claveDe(nuevas.get(e1.incidencia_id)!)).toBe(claveDe(antesInc.get(e0.incidencia_id)!)); // misma identidad lógica
      expect(usadas.has(e1.incidencia_id)).toBe(false); // una evidencia por incidencia (sin duplicados inesperados)
      usadas.add(e1.incidencia_id);
    }
  });

  it("se conservan EXACTAS ruta_archivo, nombre_original, subido_en, subido_por, empresa_id (y el id de la evidencia)", async () => {
    const antes = bd.instantanea().evidencias;
    await aplicar();
    const despues = bd.instantanea().evidencias;
    for (const e0 of antes) {
      const e1 = despues.find((x) => x.id === e0.id)!;
      expect({ ...e1, incidencia_id: 0 }).toEqual({ ...e0, incidencia_id: 0 });
      expect(e1.ruta_archivo).toBe(e0.ruta_archivo);
      expect(e1.nombre_original).toBe(e0.nombre_original);
      expect(e1.subido_en).toBe(e0.subido_en);
      expect(e1.subido_por).toBe(e0.subido_por);
      expect(e1.empresa_id).toBe(e0.empresa_id);
    }
  });

  it("ninguna evidencia queda huérfana", async () => {
    await aplicar();
    const t = bd.instantanea();
    const ids = new Set(t.incidencias.map((i) => i.id));
    expect(t.evidencias.every((e) => ids.has(e.incidencia_id))).toBe(true);
  });

  it("el CASCADE de las incidencias viejas SÍ borra las filas de evidencia, pero no hay pérdida porque el staging se capturó antes", async () => {
    await aplicar();
    const iBorrado = bd.traza.findIndex((x) => x.sql.startsWith("DELETE FROM incidencias"));
    expect(iBorrado).toBeGreaterThan(0);
    // tras el DELETE de incidencias solo sobrevive la evidencia de la incidencia de OTRO tipo (no objetivo): el CASCADE borró las 13
    expect(bd.traza[iBorrado].evidencias).toBe(1);
    // …y al terminar están las 13 (+1 de otro tipo), recreadas desde el staging
    expect(bd.instantanea().evidencias).toHaveLength(14);
    // el staging existe ANTES del primer DELETE: los respaldos y los locks preceden a cualquier borrado
    const primerDelete = bd.ejecutadas.findIndex((s) => s.startsWith("DELETE"));
    const ultimoRespaldo = bd.ejecutadas.map((s, i) => (s.startsWith("CREATE TABLE") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(ultimoRespaldo).toBeLessThan(primerDelete);
  });

  it("sin evidencias también funciona (0 antes = 0 después)", async () => {
    bd.reiniciar(escenarioBase({ conEvidencias: false }));
    const r = await dry();
    expect(r.resumen).toMatchObject({ evidenciasARelinkear: 0, evidenciasRelinkeables: 0 });
    expect(r.puedeAplicarse).toBe(true);
    const res = await aplicar();
    expect(res).toMatchObject({ ok: true, evidenciasRelinkeadas: 0, vacaciones: 13 });
    expect(bd.instantanea().evidencias).toHaveLength(0);
  });

  it("NO toca incidencias de otros tipos ni sus evidencias", async () => {
    const otraInc = bd.instantanea().incidencias.find((i) => i.id === 90001)!;
    const otraEv = bd.instantanea().evidencias.find((e) => e.id === 90002)!;
    await aplicar();
    const t = bd.instantanea();
    expect(t.incidencias.find((i) => i.id === 90001)).toEqual(otraInc);
    expect(t.evidencias.find((e) => e.id === 90002)).toEqual(otraEv);
    expect(bd.ejecutadas.some((s) => /DELETE FROM incidencias/.test(s) && !s.includes("tipo IN ('Vacaciones', 'A cuenta de Vacaciones') AND id IN"))).toBe(false);
  });
});

describe("aplicador: reconstrucción", () => {
  it("regenera períodos desde fecha_alta, reinserta las 13 vacaciones y su FIFO y deja el módulo consistente", async () => {
    await aplicar();
    const t = bd.instantanea();
    expect(t.vacaciones.filter((v) => v.empresa_id === EMPRESA)).toHaveLength(13);
    expect(t.incidencias.filter((i) => ["Vacaciones", "A cuenta de Vacaciones"].includes(i.tipo))).toHaveLength(13);
    for (const inc of t.incidencias.filter((i) => ["Vacaciones", "A cuenta de Vacaciones"].includes(i.tipo))) {
      const suma = Math.round(t.detalle.filter((d) => d.incidencia_id === inc.id).reduce((s, d) => s + d.dias_tomados, 0) * 100) / 100;
      expect(suma).toBe(inc.dias_habiles);
    }
    const ana = t.saldos.filter((s) => s.id_empleado === 1).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));
    expect(ana[0]).toMatchObject({ anio_laboral: 1, periodo_inicio: "2020-01-06", periodo_fin: "2021-01-05" });
    expect(ana.length).toBeGreaterThanOrEqual(6);
    expect(t.saldos.every((s) => s.dias_disponibles >= 0)).toBe(true);
    // Elisa (fecha 1899): sus saldos NO se tocan
    expect(t.saldos.filter((s) => s.id_empleado === 37)).toHaveLength(1);
    expect(t.saldos.find((s) => s.id_empleado === 37)!.id).toBe(5);
  });

  it("crea respaldos bk_reset_<sello>_* separados (6 tablas, evidencias con IDs originales y todos los campos) y no toca el respaldo histórico", async () => {
    const antesEv = bd.instantanea().evidencias;
    const r = await aplicar();
    expect(r.respaldos.sort()).toEqual(Object.values(nombresRespaldo(SELLO)).sort());
    expect(Object.keys(bd.backups).sort()).toEqual(Object.values(nombresRespaldo(SELLO)).sort());
    const bkEv = bd.backups[`bk_reset_${SELLO}_evidencias_incidencias`];
    expect(bkEv).toHaveLength(antesEv.length);
    for (const e of antesEv) {
      expect(bkEv.find((x) => x.id === e.id)).toMatchObject({ id: e.id, empresa_id: e.empresa_id, incidencia_id: e.incidencia_id, ruta_archivo: e.ruta_archivo, nombre_original: e.nombre_original, subido_en: e.subido_en, subido_por: e.subido_por });
    }
    expect(bkEv.find((x) => x.id === antesEv.find((e) => e.id !== 90002)!.id)).toHaveProperty("id_empleado");
    expect(bd.backups[`bk_reset_${SELLO}_vacaciones`]).toHaveLength(13);
    expect(bd.historico).toBe(441);
    expect(bd.ejecutadas.some((s) => s.includes("backup_saldos_vacaciones_20261006") && !s.startsWith("SELECT COUNT"))).toBe(false);
  });

  it("nunca sobrescribe respaldos: un sello ya usado se rechaza antes de tocar nada", async () => {
    await aplicar();
    const t1 = bd.instantanea();
    const d = await dry();
    await expect(aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(d.huellaFuente) }, deps)).rejects.toMatchObject({ codigo: "RESPALDO_EXISTENTE" });
    expect(sinAuditoria(bd.instantanea())).toEqual(sinAuditoria(t1));
  });

  it("registra la auditoría (aplicación y decisiones) dentro de la misma transacción", async () => {
    await aplicar();
    const a = bd.instantanea().auditoria;
    expect(a.map((x) => x.accion)).toEqual(["RECONSTRUCCION_VACACIONES"]);
    expect(a[0]).toMatchObject({ empresa_id: EMPRESA, usuario: "admin.rrhh", modulo: "rrhh" });
    expect(JSON.parse(a[0].detalle!)).toMatchObject({ sello: SELLO, evidenciasRelinkeadas: 13 });
    expect(bd.eventos).toEqual(["BEGIN", "COMMIT", "RELEASE"]);
  });

  it("no borra archivos físicos: ni el aplicador ni el plan invocan helpers de borrado, y no importan fs/uploads", async () => {
    await aplicar();
    expect(fisico.borrarUpload).not.toHaveBeenCalled();
    expect(fisico.borrarArchivosFisicos).not.toHaveBeenCalled();
    for (const f of ["vacaciones-reconstruccion-aplicador.ts", "vacaciones-reconstruccion-plan.ts", "vacaciones-reconstruccion-decisiones.ts"]) {
      const src = readFileSync(`src/lib/rrhh/${f}`, "utf8");
      expect(src, f).not.toMatch(/from\s+["'](node:)?fs(\/promises)?["']/);
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/(uploads|admin\/limpiar-archivos)["']/);
      expect(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), f).not.toMatch(/\b(unlink|unlinkSync|rmSync|rm\(|borrarUpload|borrarArchivosFisicos)\b/);
    }
  });
});

describe("aplicador: todo-o-nada (ROLLBACK COMPLETO)", () => {
  const estadoDatos = () => { const t = bd.instantanea(); return { ...t, auditoria: [] }; };

  async function debeRevertir(fallo: (sql: string) => boolean) {
    const antes = estadoDatos();
    const d = await dry();
    bd.fallarSi = (sql) => fallo(sql);
    const p = aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(d.huellaFuente) }, deps);
    await expect(p).rejects.toBeInstanceOf(ErrorAplicacion);
    expect(estadoDatos()).toEqual(antes); // idéntico al inicial: ni vacaciones, ni incidencias, ni FIFO, ni saldos, ni evidencias
    expect(bd.eventos).toContain("ROLLBACK");
    expect(bd.eventos).not.toContain("COMMIT");
  }

  it("fallo durante el RELINK de evidencias ⇒ rollback total (las 13 evidencias originales siguen donde estaban)", async () => {
    await debeRevertir((s) => s.startsWith("INSERT INTO evidencias_incidencias"));
    expect(bd.instantanea().evidencias).toHaveLength(14);
  });

  it("fallo durante el FIFO nuevo ⇒ rollback total", async () => {
    await debeRevertir((s) => s.startsWith("INSERT INTO detalle_consumo_vacaciones"));
  });

  it("fallo al eliminar el FIFO objetivo ⇒ rollback total", async () => {
    await debeRevertir((s) => s.startsWith("DELETE FROM detalle_consumo_vacaciones"));
  });

  it("fallo durante la reconstrucción (inserción de incidencias / períodos) ⇒ rollback total", async () => {
    await debeRevertir((s) => s.startsWith("INSERT INTO incidencias"));
    bd.reiniciar(escenarioBase());
    await debeRevertir((s) => s.startsWith("INSERT INTO saldos_vacaciones"));
  });

  it("fallo al eliminar incidencias o saldos ⇒ rollback total", async () => {
    await debeRevertir((s) => s.startsWith("DELETE FROM incidencias"));
    bd.reiniciar(escenarioBase());
    await debeRevertir((s) => s.startsWith("DELETE FROM saldos_vacaciones"));
  });

  it("fallo en la auditoría ⇒ rollback total", async () => {
    await debeRevertir((s) => s.startsWith("INSERT INTO auditoria"));
  });

  it("la verificación final detecta una evidencia alterada y revierte TODO", async () => {
    const antes = estadoDatos();
    const d = await dry();
    bd.despuesDe.push({ patron: /^INSERT INTO evidencias_incidencias/, fn: (t) => { t.evidencias[t.evidencias.length - 1].ruta_archivo = "otra/ruta.pdf"; } });
    await expect(aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(d.huellaFuente) }, deps)).rejects.toMatchObject({ codigo: "VERIFICACION_FALLIDA" });
    expect(estadoDatos()).toEqual(antes);
  });

  it("la verificación detecta una evidencia perdida (cardinalidad) y revierte TODO", async () => {
    const antes = estadoDatos();
    const d = await dry();
    bd.despuesDe.push({ patron: /^INSERT INTO evidencias_incidencias/, fn: (t) => { t.evidencias.pop(); } });
    await expect(aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(d.huellaFuente) }, deps)).rejects.toMatchObject({ codigo: "VERIFICACION_FALLIDA" });
    expect(estadoDatos()).toEqual(antes);
  });

  it("los respaldos creados antes de la transacción permanecen aunque haya rollback (DDL), y nada más cambia", async () => {
    const d = await dry();
    bd.fallarSi = (s) => s.startsWith("INSERT INTO detalle_consumo_vacaciones");
    await expect(aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(d.huellaFuente) }, deps)).rejects.toBeInstanceOf(ErrorAplicacion);
    expect(Object.keys(bd.backups)).toHaveLength(6);
  });
});

describe("aplicador: confirmaciones y validaciones previas (nada se escribe si fallan)", () => {
  const sinCambios = async (fn: () => Promise<unknown>, codigo: string) => {
    const antes = bd.instantanea();
    await expect(fn()).rejects.toMatchObject({ codigo });
    expect(bd.instantanea()).toEqual(antes);
    expect(Object.keys(bd.backups)).toEqual([]);
    expect(bd.eventos).toEqual([]);
  };

  it("frase, sello, usuario, empresa y huella inválidos ⇒ CONFIRMACION_INVALIDA", async () => {
    const d = await dry();
    const base = confirmacion(d.huellaFuente);
    await sinCambios(() => aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: { ...base, frase: "si" } }, deps), "CONFIRMACION_INVALIDA");
    await sinCambios(() => aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: { ...base, sello: "hoy" } }, deps), "CONFIRMACION_INVALIDA");
    await sinCambios(() => aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: { ...base, usuario: "" } }, deps), "CONFIRMACION_INVALIDA");
    await sinCambios(() => aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: { ...base, empresaId: 99 } }, deps), "CONFIRMACION_INVALIDA");
    await sinCambios(() => aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: { ...base, huellaFuente: "abc" } }, deps), "CONFIRMACION_INVALIDA");
  });

  it("la fuente cambió desde el dry-run revisado (huella distinta) ⇒ FUENTE_CAMBIO", async () => {
    const d = await dry();
    bd.t.evidencias[0].ruta_archivo = "empresas/7/evidencias/otra.pdf";
    await sinCambios(() => aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(d.huellaFuente) }, deps), "FUENTE_CAMBIO");
  });

  it("export NO lossless (duplicado idéntico) ⇒ PLAN_NO_APLICABLE sin escribir nada", async () => {
    const t = escenarioBase();
    const v = t.vacaciones[0]; const i = t.incidencias.find((x) => x.fecha_inicio === v.fecha_inicio && x.id_empleado === v.id_empleado)!;
    t.vacaciones.push({ ...v, id: 99001 }); t.incidencias.push({ ...i, id: 99002 });
    bd.reiniciar(t);
    const r = await dry();
    expect(r.puedeAplicarse).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain("EXPORT_NO_LOSSLESS");
    await sinCambios(() => aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(r.huellaFuente) }, deps), "PLAN_NO_APLICABLE");
  });

  it("vacación futura o superpuesta ⇒ no aplicable", async () => {
    const t = escenarioBase();
    t.vacaciones.push({ id: 99010, empresa_id: EMPRESA, id_empleado: 4, fecha_inicio: "2027-01-04", fecha_fin: "2027-01-08", dias_habiles: 5, observaciones: null, estado: "Aprobado" });
    t.incidencias.push({ id: 99011, empresa_id: EMPRESA, id_empleado: 4, tipo: "Vacaciones", fecha_inicio: "2027-01-04", fecha_fin: "2027-01-08", dias_habiles: 5 });
    bd.reiniciar(t);
    const r = await dry();
    expect(r.puedeAplicarse).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain("HISTORIAL_CON_ERRORES");
  });

  it("solicitudes ligadas a incidencias objetivo ⇒ SOLICITUDES_LIGADAS (no aplicable)", async () => {
    const t = escenarioBase();
    t.solicitudes.push({ id: 1, empresa_id: EMPRESA, incidencia_id: t.incidencias[0].id });
    bd.reiniciar(t);
    const r = await dry();
    expect(r.puedeAplicarse).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain("SOLICITUDES_LIGADAS");
  });

  it("detalle FIFO ajeno al conjunto objetivo ⇒ DETALLE_AJENO (jamás se borra FIFO fuera del objetivo)", async () => {
    const t = escenarioBase();
    t.incidencias.push({ id: 99020, empresa_id: EMPRESA, id_empleado: 1, tipo: "IGSS", fecha_inicio: "2024-09-02", fecha_fin: "2024-09-03", dias_habiles: 2 });
    t.detalle.push({ id: 99021, incidencia_id: 99020, saldo_id: 1, dias_tomados: 2 });
    bd.reiniciar(t);
    const r = await dry();
    expect(r.puedeAplicarse).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain("DETALLE_AJENO");
  });
});

describe("relink: identidad lógica (planificador)", () => {
  const fuenteBase = async () => cargarFuente(EMPRESA, bd.consulta as unknown as Consulta);

  it("0 coincidencias nuevas ⇒ HARD ERROR (SIN_COINCIDENCIA) y el plan no es aplicable", async () => {
    const f = await fuenteBase();
    f.evidencias[0] = { ...f.evidencias[0], fechaInicio: "2019-01-01" }; // identidad lógica que ninguna incidencia nueva tiene
    const plan = planificarReconstruccion(f, { hoy: HOY });
    expect(plan.puedeAplicarse).toBe(false);
    expect(plan.evidencias.errores).toEqual([expect.objectContaining({ evidenciaId: f.evidencias[0].id, codigo: "SIN_COINCIDENCIA" })]);
    expect(plan.bloqueos.map((b) => b.codigo)).toContain("RELINK_IMPOSIBLE");
    expect(plan.resumen).toMatchObject({ evidenciasARelinkear: 13, evidenciasRelinkeables: 12, erroresRelink: 1 });
  });

  it("2 coincidencias nuevas ⇒ HARD ERROR (MULTIPLES_COINCIDENCIAS): nunca se elige una", async () => {
    const f = await fuenteBase();
    const ev = f.evidencias[0];
    const clave = claveLogicaVacacion(ev.idEmpleado, ev.tipo, ev.fechaInicio, ev.fechaFin, ev.diasHabiles);
    const { relinks, errores } = resolverRelinks([ev], [{ clave }, { clave }], EMPRESA);
    expect(relinks).toEqual([]);
    expect(errores).toEqual([expect.objectContaining({ evidenciaId: ev.id, codigo: "MULTIPLES_COINCIDENCIAS" })]);
  });

  it("filas idénticas en el historial (que producirían 2 coincidencias) ya bloquean el plan por duplicado/superposición", async () => {
    const f = await fuenteBase();
    const dup = f.exportacion.filas.find((x) => x.codigo === "E-1")!;
    f.exportacion = { ...f.exportacion, filas: [...f.exportacion.filas, { ...dup }] };
    const plan = planificarReconstruccion(f, { hoy: HOY });
    expect(plan.puedeAplicarse).toBe(false);
    expect(plan.bloqueos.map((b) => b.codigo)).toContain("HISTORIAL_CON_ERRORES");
  });

  it("0 coincidencias con la función de relink: SIN_COINCIDENCIA", () => {
    const { relinks, errores } = resolverRelinks(
      [{ id: 1, empresaId: EMPRESA, incidenciaId: 5, idEmpleado: 1, tipo: "Vacaciones", fechaInicio: "2024-01-01", fechaFin: "2024-01-05", diasHabiles: 5, rutaArchivo: "r", nombreOriginal: null, subidoEn: "2024-01-06 10:00:00", subidoPor: null }],
      [{ clave: "otra" }], EMPRESA,
    );
    expect(relinks).toEqual([]);
    expect(errores[0].codigo).toBe("SIN_COINCIDENCIA");
  });

  it("la identidad NO es el ID viejo: cambiar los ids de las incidencias no cambia el relink", async () => {
    const f1 = await fuenteBase();
    const f2 = await fuenteBase();
    f2.evidencias = f2.evidencias.map((e) => ({ ...e, incidenciaId: e.incidenciaId + 10000 }));
    const p1 = planificarReconstruccion(f1, { hoy: HOY });
    const p2 = planificarReconstruccion(f2, { hoy: HOY });
    expect(p2.evidencias.relinks.map((r) => r.claveLogica)).toEqual(p1.evidencias.relinks.map((r) => r.claveLogica));
    expect(p2.resumen.evidenciasRelinkeables).toBe(13);
  });

  it("la identidad incluye el tipo: una evidencia de «Vacaciones» no se relinkea a una «A cuenta de Vacaciones» con las mismas fechas", async () => {
    const f = await fuenteBase();
    const e = f.evidencias.find((x) => x.tipo === "Vacaciones")!;
    f.evidencias = f.evidencias.map((x) => (x.id === e.id ? { ...x, tipo: "A cuenta de Vacaciones" } : x));
    const plan = planificarReconstruccion(f, { hoy: HOY });
    expect(plan.evidencias.errores.map((x) => x.codigo)).toEqual(["SIN_COINCIDENCIA"]);
  });
});

describe("decisión pendiente de Álvaro (vacación que cruza un aniversario)", () => {
  beforeEach(() => bd.reiniciar(escenarioAlvaro()));

  it("mientras exista la DECISION pendiente: puedeAplicarse = false y el aplicador NO se ejecuta (nada se escribe)", async () => {
    const r = await dry();
    expect(r.puedeAplicarse).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toEqual(["DECISIONES_PENDIENTES"]);
    expect(r.decisiones.pendientes).toHaveLength(1);
    const p = r.decisiones.pendientes[0];
    expect(p).toMatchObject({ codigo: "VACACION_CRUZA_ANIVERSARIO", empleado: "Álvaro Antonio León Pinto", inicio: "2025-10-20", fin: "2025-11-05", dias: 15 });
    expect(p.mensaje).toContain("2025-10-30");
    expect(p.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(p.plantilla).toMatchObject({ clave: p.clave, tipo: "ACEPTAR_PROPUESTA", huella: p.huella });
    const antes = bd.instantanea();
    await expect(aplicarReconstruccion({ empresaId: EMPRESA, confirmacion: confirmacion(r.huellaFuente) }, deps)).rejects.toMatchObject({ codigo: "PLAN_NO_APLICABLE" });
    expect(bd.instantanea()).toEqual(antes);
    expect(Object.keys(bd.backups)).toEqual([]);
  });

  const resolver = (p: { clave: string; huella: string }, extra: Record<string, unknown> = {}) => ({
    clave: p.clave, tipo: "ACEPTAR_PROPUESTA", huella: p.huella, resueltoPor: "gerente.rrhh", resueltoEn: "2026-10-07T10:00:00-06:00", motivo: "Aprobado por la gerencia de RRHH tras revisar la boleta.", ...extra,
  });

  it("con una decisión explícita y auditable (atada a la huella de la propuesta) el plan es aplicable y se audita", async () => {
    const pend = (await dry()).decisiones.pendientes[0];
    const decisiones = [resolver(pend)];
    const r = await dry(decisiones);
    expect(r.puedeAplicarse).toBe(true);
    expect(r.decisiones.aplicadas).toHaveLength(1);
    const res = await aplicar(decisiones);
    expect(res).toMatchObject({ ok: true, vacaciones: 1, evidenciasRelinkeadas: 1 });
    const aud = bd.instantanea().auditoria;
    expect(aud.map((a) => a.accion)).toEqual(["RECONSTRUCCION_VACACIONES", "RECONSTRUCCION_VACACIONES_DECISION"]);
    expect(JSON.parse(aud[1].detalle!)).toMatchObject({ resueltoPor: "gerente.rrhh", tipo: "ACEPTAR_PROPUESTA", clave: pend.clave });
  });

  it("una decisión con huella distinta (otra propuesta), mal formada o que no corresponde ⇒ no aplicable", async () => {
    const pend = (await dry()).decisiones.pendientes[0];
    const otraHuella = await dry([resolver(pend, { huella: "0".repeat(64) })]);
    expect(otraHuella.puedeAplicarse).toBe(false);
    expect(otraHuella.decisiones.errores.join(" ")).toContain("huella no coincide");
    const sinMotivo = await dry([resolver(pend, { motivo: "ok" })]);
    expect(sinMotivo.puedeAplicarse).toBe(false);
    expect(sinMotivo.bloqueos.map((b) => b.codigo)).toContain("DECISION_INVALIDA");
    const ajena = await dry([resolver({ clave: "VACACION_CRUZA_ANIVERSARIO|E-99|2025-01-01|2025-01-05|5.00", huella: pend.huella })]);
    expect(ajena.puedeAplicarse).toBe(false);
    expect(ajena.decisiones.errores.join(" ")).toContain("no corresponde a ninguna decisión pendiente");
  });

  it("REPARTO_MANUAL: RRHH fija cuántos días salen de cada año laboral; debe sumar los días de la vacación y queda auditado", async () => {
    const pend = (await dry()).decisiones.pendientes[0];
    const mal = await dry([resolver(pend, { tipo: "REPARTO_MANUAL", reparto: [{ anioLaboral: 3, dias: 10 }] })]);
    expect(mal.puedeAplicarse).toBe(false);
    expect(mal.decisiones.errores.join(" ")).toContain("suma 10");
    const decisiones = [resolver(pend, { tipo: "REPARTO_MANUAL", reparto: [{ anioLaboral: 2, dias: 10 }, { anioLaboral: 3, dias: 5 }] })];
    const ok = await dry(decisiones);
    expect(ok.puedeAplicarse).toBe(true);
    await aplicar(decisiones);
    const t = bd.instantanea();
    const inc = t.incidencias.find((i) => i.tipo === "Vacaciones")!;
    const sal = (anio: number) => t.saldos.find((s) => s.id_empleado === 10 && s.anio_laboral === anio)!.id;
    expect(t.detalle.filter((d) => d.incidencia_id === inc.id).map((d) => [d.saldo_id, d.dias_tomados]).sort()).toEqual([[sal(2), 10], [sal(3), 5]].sort());
  });
});

describe("alcance multiempresa", () => {
  it("no lee ni toca datos de otra empresa", async () => {
    const t = escenarioBase();
    t.empleados.push({ id: 500, empresa_id: 8, codigo: "E-1", nombre: "Otra Empresa", fecha_alta: "2021-01-04", fecha_inicio_laboral: "2021-01-04", dpi: null });
    t.saldos.push({ id: 900, empresa_id: 8, id_empleado: 500, anio_laboral: 1, periodo_inicio: "2021-01-04", periodo_fin: "2022-01-03", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" });
    t.incidencias.push({ id: 901, empresa_id: 8, id_empleado: 500, tipo: "Vacaciones", fecha_inicio: "2024-05-06", fecha_fin: "2024-05-10", dias_habiles: 5 });
    t.vacaciones.push({ id: 902, empresa_id: 8, id_empleado: 500, fecha_inicio: "2024-05-06", fecha_fin: "2024-05-10", dias_habiles: 5, observaciones: null, estado: "Aprobado" });
    t.evidencias.push({ id: 903, empresa_id: 8, incidencia_id: 901, ruta_archivo: "empresas/8/evidencias/x.pdf", nombre_original: "x.pdf", subido_en: "2024-05-11 10:00:00", subido_por: "otro" });
    bd.reiniciar(t);
    await aplicar();
    const d = bd.instantanea();
    expect(d.saldos.find((s) => s.id === 900)).toBeTruthy();
    expect(d.incidencias.find((i) => i.id === 901)).toBeTruthy();
    expect(d.vacaciones.find((v) => v.id === 902)).toBeTruthy();
    expect(d.evidencias.find((e) => e.id === 903)).toMatchObject({ incidencia_id: 901 });
    for (const sql of bd.ejecutadas.filter((s) => /^(DELETE|INSERT)/.test(s) && !s.startsWith("INSERT INTO auditoria"))) {
      expect(sql, sql).toMatch(/empresa_id|detalle_consumo_vacaciones|id, empresa_id/);
    }
  });
});
