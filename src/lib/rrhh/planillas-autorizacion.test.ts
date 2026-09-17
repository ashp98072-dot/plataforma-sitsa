import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("./isr", () => ({ calcularISRMensual: () => 100 }));
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { generarLineasPeriodo, autorizarPeriodoPlanilla, marcarPagos, actualizarLinea, actualizarEstadoPeriodo, listarLineas } from "./planillas";
import { obtenerConceptosPendientes, leerConceptosSnapshot, validarSnapshotContraPendientes, pendientesVacios } from "./planilla-conceptos";

type Row = Record<string, unknown>;
let periodo: Row;
let lineas: Row[];
let cuotas: Row[];
let horas: Row[];
let maestros: Row[];
let abonos: Row[];
let legado: Row[];
let prestaciones: Row[];
let backup: string;
let fallo: string;
let sueldo: number;
const conn = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), query: vi.fn(), execute: vi.fn() };
const generar = () => generarLineasPeriodo(3, 1, { usuario: "prueba" });
const autorizar = () => autorizarPeriodoPlanilla(3, 1, "gerente");
beforeEach(() => {
  vi.resetAllMocks(); sueldo = 4000; fallo = "";
  periodo = { id: 1, empresa_id: 3, codigo: "PRUEBA", estado: "Borrador", autorizado_en: null, autorizado_por: null, fecha_inicio: "2025-08-01", fecha_fin: "2025-08-15", tipo_periodo: "QUINCENA_1", mes: 8, anio: 2025 };
  lineas = []; abonos = [];
  maestros = [{ id: 11, empresa_id: 3, empleado_id: 7, estado: "ACTIVO", monto_original: 600, periodicidad: "QUINCENAL", concepto: "Anticipo", fecha_inicio: "2025-08-01" }];
  cuotas = [1, 2, 3].map((n) => ({ id: 20 + n, empresa_id: 3, descuento_id: 11, numero_cuota: n, estado: "PENDIENTE", planilla_periodo_id: null, fecha_programada: "2025-08-01", monto_programado: 200 }));
  horas = [{ id: 31, empresa_id: 3, id_empleado: 7, estado: "APROBADA", fecha: "2025-08-10", monto: 125, horas: 5, planilla_periodo_id: null }];
  legado = [{ id: 41, empresa_id: 3, id_empleado: 7, concepto: "Descuento legado", fecha: "2025-08-01", monto: 25 }];
  prestaciones = [{ id: 51, empresa_id: 3, id_empleado: 7, concepto: "Prestación", fecha: "2025-08-01", monto: 75 }];
  conn.beginTransaction.mockImplementation(async () => { backup = JSON.stringify({ periodo, lineas, cuotas, horas, maestros, abonos, legado, prestaciones }); });
  conn.rollback.mockImplementation(async () => { ({ periodo, lineas, cuotas, horas, maestros, abonos, legado, prestaciones } = JSON.parse(backup)); });
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  vi.mocked(query).mockImplementation(async (sql, params) => {
    if (sql.includes("FROM rrhh_planilla_periodos")) return (Number(params?.[0]) === 3 ? [periodo] : []) as never;
    if (sql.includes("FROM empleados")) return [{ id: 7, codigo: "E7", nombre: "Empleado", sueldo_base: sueldo, bono_incentivo: 250, bono_herramientas: 0 }] as never;
    if (sql.includes("SELECT l.*")) return lineas.map((l) => ({ ...l, sueldo_mensual: sueldo })) as never;
    return [] as never;
  });
  conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM empleados")) return [Number(params[0]) === 3 && params.slice(1).includes(7) ? [{ id: 7, sueldo_base: sueldo }] : [], []];
    if (sql.includes("SELECT id, estado FROM")) return [Number(params[0]) === 3 ? [periodo] : [], []];
    if (sql.includes("SELECT q2.id")) return [[], []];
    if (sql.includes("SELECT autorizado_en") || sql.includes("SELECT * FROM rrhh_planilla_periodos")) return [[periodo], []];
    if (sql.includes("FROM rrhh_planilla_lineas")) return [lineas, []];
    if (sql.includes("AS pendientes")) return [[{ ...maestros[0], aplicado: cuotas.filter((c) => c.estado === "APLICADA").reduce((sum, c) => sum + Number(c.monto_aplicado), 0), abonado: 0, pendientes: cuotas.filter((c) => c.estado === "PENDIENTE").length }], []];
    const deEmpresa = (rows: Row[]) => rows.filter((r) => Number(r.empresa_id) === Number(params[0]));
    if (sql.includes("FROM rrhh_descuentos_maestro")) return [deEmpresa(maestros), []];
    if (sql.includes("FROM rrhh_descuento_cuotas")) return [deEmpresa(cuotas), []];
    if (sql.includes("FROM rrhh_descuento_abonos")) return [deEmpresa(abonos), []];
    if (sql.includes("FROM horas_extra_registros")) return [deEmpresa(horas), []];
    if (sql.includes("FROM rrhh_descuentos")) return [deEmpresa(legado), []];
    if (sql.includes("FROM rrhh_prestaciones")) return [deEmpresa(prestaciones), []];
    return [[], []];
  });
  conn.execute.mockImplementation(async (sql: string, p: unknown[]) => {
    if (fallo && sql.includes(fallo)) throw new Error("Fallo transaccional simulado");
    if (sql.includes("INSERT INTO rrhh_planilla_lineas")) {
      const keys = ["empresa_id", "periodo_id", "id_empleado", "codigo_empleado", "nombre_empleado", "dpi", "tipo_contrato", "forma_pago", "sueldo_base", "bono_incentivo", "bono_herramientas", "otros_ingresos", "igss_laboral", "igss_patronal", "descuentos", "isr", "neto", "estado_pago", "ref_pago", "conceptos_snapshot"];
      lineas = [{ ...Object.fromEntries(keys.map((k, i) => [k, p[i]])), id: lineas[0]?.id ?? 100 }];
    } else if (sql.includes("UPDATE rrhh_descuento_cuotas")) {
      const c = cuotas.find((c) => c.id === p[4])!;
      if (c.estado !== "PENDIENTE") return [{ affectedRows: 0 }, []];
      c.estado = "APLICADA"; c.planilla_periodo_id = p[0]; c.monto_aplicado = p[1];
    } else if (sql.includes("INSERT INTO rrhh_descuento_cuotas")) {
      cuotas.push({ id: 99, empresa_id: p[0], descuento_id: p[1], estado: "APLICADA", monto_aplicado: p[5], planilla_periodo_id: p[4], numero_cuota: 1 });
    } else if (sql.includes("UPDATE horas_extra_registros")) {
      const h = horas.find((h) => h.id === p[2])!;
      h.estado = "APLICADA_EN_PLANILLA"; h.planilla_periodo_id = p[0];
    } else if (sql.includes("UPDATE rrhh_planilla_periodos")) {
      if (sql.includes("autorizado_en = NOW()")) { periodo.estado = "Cerrada"; periodo.autorizado_por = p[0]; periodo.autorizado_en = "2025-09-16 12:00:00"; }
      else periodo.estado = "Generada";
    } else if (sql.includes("UPDATE rrhh_descuentos_maestro")) maestros[0].estado = "FINALIZADO";
    else if (sql.includes("SET estado_pago")) for (const l of lineas) l.estado_pago = p[0];
    return [{ affectedRows: 1 }, []];
  });
});

describe("generar / regenerar / autorizar con fuentes reales simuladas", () => {
  it("cinco generaciones incluyen la misma cuota y HE sin consumir, duplicar ni perder conceptos", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await generar();
      expect(r.cuotasAplicadas).toBe(0); expect(r.horasExtraAplicadas).toBe(0);
      expect(lineas).toHaveLength(1); expect(lineas[0]).toMatchObject({ descuentos: 225, otros_ingresos: 200 });
      const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
      expect(s.sueldoMensual).toBe(4000); expect(s.cuotas.map((c) => c.id)).toEqual([21]); expect(s.horasExtra.map((h) => h.id)).toEqual([31]);
      expect(cuotas.every((c) => c.estado === "PENDIENTE")).toBe(true); expect(horas[0].estado).toBe("APROBADA");
      expect(periodo.autorizado_en).toBeNull();
    }
    expect(conn.execute.mock.calls.some(([sql]) => /UPDATE (rrhh_descuento|horas_extra)/.test(sql))).toBe(false);
  });
  it("autoriza una sola vez, registra usuario y auditoría antes de commit, y congela el snapshot", async () => {
    await generar(); const antes = JSON.stringify(lineas); conn.commit.mockClear();
    await autorizar();
    expect(cuotas.filter((c) => c.estado === "APLICADA")).toHaveLength(1);
    expect(horas[0]).toMatchObject({ estado: "APLICADA_EN_PLANILLA", planilla_periodo_id: 1 });
    expect(periodo).toMatchObject({ estado: "Cerrada", autorizado_por: "gerente", autorizado_en: expect.any(String) });
    expect(JSON.stringify(lineas)).toBe(antes);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ empresaId: 3, usuario: "gerente", accion: "autorizar_periodo_planilla" }));
    expect(vi.mocked(registrarAuditoriaTx).mock.invocationCallOrder[0]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
    conn.execute.mockClear(); await expect(autorizar()).rejects.toThrow("ya está autorizada"); expect(conn.execute).not.toHaveBeenCalled();
    await expect(generar()).rejects.toThrow("no se puede regenerar");
  });
  it.each(["UPDATE horas_extra_registros", "UPDATE rrhh_planilla_periodos"])("rollback restaura cuota y HE si falla %s", async (punto) => {
    await generar(); fallo = punto; conn.commit.mockClear();
    await expect(autorizar()).rejects.toThrow("Fallo transaccional");
    expect(cuotas[0].estado).toBe("PENDIENTE"); expect(horas[0].estado).toBe("APROBADA"); expect(periodo.autorizado_en).toBeNull();
    expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalled();
  });
  it("fallo de auditoría también revierte consumo y autorización", async () => {
    await generar(); vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("Auditoría"));
    await expect(autorizar()).rejects.toThrow("Auditoría");
    expect(cuotas[0].estado).toBe("PENDIENTE"); expect(horas[0].estado).toBe("APROBADA"); expect(periodo.autorizado_en).toBeNull();
  });
  it.each(["monto", "estado", "otroPeriodo", "abono", "legado", "prestacion", "hora"])("rechaza cambio %s sin aplicar nada", async (cambio) => {
    await generar(); conn.execute.mockClear();
    if (cambio === "monto") cuotas[0].monto_programado = 201;
    if (cambio === "estado") maestros[0].estado = "PAUSADO";
    if (cambio === "otroPeriodo") { cuotas[0].estado = "APLICADA"; cuotas[0].planilla_periodo_id = 2; cuotas[0].monto_aplicado = 200; }
    if (cambio === "abono") abonos.push({ id: 1, empresa_id: 3, descuento_id: 11, monto: 10 });
    if (cambio === "legado") legado[0].monto = 26;
    if (cambio === "prestacion") prestaciones[0].monto = 76;
    if (cambio === "hora") horas[0].monto = 126;
    await expect(autorizar()).rejects.toThrow(/Regenera|Regenera|regenerar/i);
    expect(conn.execute).not.toHaveBeenCalled(); expect(periodo.autorizado_en).toBeNull();
  });
  it("snapshot NULL o adulterado no permite autorización retroactiva", async () => {
    await generar(); lineas[0].conceptos_snapshot = null;
    await expect(autorizar()).rejects.toThrow("snapshot");
    expect(cuotas[0].estado).toBe("PENDIENTE");
  });
  it("histórico con aplicaciones previas se bloquea y no libera nada", async () => {
    periodo.estado = "Generada"; cuotas[0].estado = "APLICADA"; cuotas[0].planilla_periodo_id = 1;
    await expect(generar()).rejects.toThrow("históricos ya aplicados");
    expect(cuotas[0].estado).toBe("APLICADA"); expect(periodo.autorizado_en).toBeNull();
  });
  it("MANUAL sin cuota solo crea y aplica su cuota al autorizar", async () => {
    cuotas = []; maestros[0].periodicidad = "MANUAL"; maestros[0].monto_original = 200;
    await generar(); await generar(); expect(cuotas).toHaveLength(0);
    expect(leerConceptosSnapshot(lineas[0].conceptos_snapshot)!.manuales[0].monto).toBe(200);
    await autorizar(); expect(cuotas).toHaveLength(1); expect(cuotas[0].estado).toBe("APLICADA");
  });
  it("pagos por lote y por línea rechazan planilla sin autorización; autorizada sí permite pagar", async () => {
    await generar();
    await expect(marcarPagos(3, 1, { estadoPago: "Pagado" })).rejects.toThrow("no está autorizada");
    await expect(actualizarLinea(3, 1, 100, { estadoPago: "Pagado" })).rejects.toThrow("no está autorizada");
    expect(lineas[0].estado_pago).toBe("Pendiente");
    await autorizar(); await marcarPagos(3, 1, { estadoPago: "Pagado" }); expect(lineas[0].estado_pago).toBe("Pagado");
  });
  it("cambio salarial antes de autorizar exige regenerar sin aplicar cuota ni HE", async () => {
    await generar(); sueldo = 5000; conn.execute.mockClear(); conn.commit.mockClear();
    await expect(autorizar()).rejects.toThrow(/información salarial cambió.*regenerarse/);
    expect(cuotas[0].estado).toBe("PENDIENTE"); expect(horas[0].estado).toBe("APROBADA");
    expect(periodo).toMatchObject({ estado: "Generada", autorizado_en: null });
    expect(conn.execute).not.toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.find(([sql]) => sql.includes("FROM empleados"))?.[1]).toEqual([3, 7]);
  });
  it("sueldo mensual aprobado no cambia si RRHH cambia el salario después", async () => {
    await generar(); await autorizar(); sueldo = 5000;
    expect((await listarLineas(3, 1))[0].sueldoMensual).toBe(4000);
    await expect(actualizarEstadoPeriodo(3, 1, "Generada", { usuario: "prueba", motivo: "Revisión" })).rejects.toThrow("reabrir una planilla autorizada");
  });
  it("empresa ajena no puede generar ni autorizar; collector excluye sus conceptos", async () => {
    maestros.push({ ...maestros[0], id: 12, empresa_id: 99, empleado_id: 99 });
    const p = await obtenerConceptosPendientes(conn as never, 3, { id: 1, fechaInicio: "2025-08-01", fechaFin: "2025-08-15" });
    expect(p.has(99)).toBe(false);
    await expect(autorizarPeriodoPlanilla(99, 1, "prueba")).rejects.toThrow("Periodo no encontrado");
    await expect(generarLineasPeriodo(99, 1, { usuario: "prueba" })).rejects.toThrow("Periodo no encontrado");
    expect(conn.query.mock.calls.filter(([sql]) => sql.includes("FROM rrhh_descuentos_maestro"))[0][1]).toEqual([3]);
  });
  it("no permite repetir identificadores o contexto de otra empresa en snapshot", async () => {
    await generar(); const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    const contexto = { empresaId: 3, periodoId: 1, empleadoId: 7, descuentos: 225, otrosIngresos: 200 };
    await expect(autorizarPeriodoPlanilla(3, 1, " ")).rejects.toThrow("usuario responsable");
    expect(() => validarSnapshotContraPendientes({ ...s, empresaId: 99 }, s, contexto)).toThrow("snapshot");
    const duplicado = { ...s, cuotas: [s.cuotas[0], s.cuotas[0]] };
    const actual = { cuotas: duplicado.cuotas, manuales: s.manuales, horasExtra: s.horasExtra, descuentosLegado: s.descuentosLegado, prestacionesLegado: s.prestacionesLegado };
    expect(() => validarSnapshotContraPendientes(duplicado, actual, contexto)).toThrow("snapshot");
    expect(() => validarSnapshotContraPendientes(null, pendientesVacios(), contexto)).toThrow("snapshot");
  });
  it("reordenar claves JSON no aparenta un cambio de conceptos", async () => {
    await generar();
    const reordenar = (v: unknown): unknown => Array.isArray(v) ? v.map(reordenar) : v !== null && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).reverse().map(([k, valor]) => [k, reordenar(valor)])) : v;
    lineas[0].conceptos_snapshot = JSON.stringify(reordenar(JSON.parse(String(lineas[0].conceptos_snapshot))));
    await autorizar(); expect(periodo.autorizado_en).not.toBeNull();
  });
  it("valida todas las líneas antes de consumir los conceptos de la primera", async () => {
    await generar();
    lineas.push({ ...lineas[0], id: 101, id_empleado: 8, conceptos_snapshot: null });
    conn.execute.mockClear();
    await expect(autorizar()).rejects.toThrow("snapshot");
    expect(conn.execute).not.toHaveBeenCalled(); expect(cuotas[0].estado).toBe("PENDIENTE");
  });
  it("UI, exportación y migración distinguen autorización y preservan fotos y NULL históricos", () => {
    const ui = readFileSync("src/app/e/[slug]/rrhh/planillas/page.tsx", "utf8");
    expect(ui).toContain("PLANILLA NO AUTORIZADA"); expect(ui).toContain("PLANILLA AUTORIZADA"); expect(ui).toContain("Autorizar planilla");
    expect(ui).toContain("FotoEmpleadoMiniatura"); expect(ui).toContain("accionEnCurso.current");
    const foto = readFileSync("src/components/rrhh/foto-empleado-miniatura.tsx", "utf8");
    expect(foto).toContain("rounded-full"); expect(foto).toContain("Sin fotografía de"); expect(foto).toContain("onError={() => setFallida(src)}");
    const exportar = readFileSync("src/app/api/empresas/[slug]/rrhh/planillas/[id]/export/route.ts", "utf8");
    expect(exportar).toContain('periodo.autorizadoEn ? "PLANILLA AUTORIZADA" : "PLANILLA NO AUTORIZADA"');
    const sql = readFileSync("sql/migrate-2026-09-rrhh-planilla-autorizacion.sql", "utf8");
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(3); expect(sql).not.toMatch(/UPDATE|DELETE|INSERT|DROP/);
  });
});
