import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/rrhh/descuentos", () => ({ aplicarCuotasElegibles: vi.fn(), sumaCuotasAplicadasPorPeriodo: vi.fn() }));
vi.mock("@/lib/rrhh/horas-extra", () => ({ aplicarHorasExtraElegibles: vi.fn(), sumaHorasExtraAplicadasPorPeriodo: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/rrhh/isr", () => ({ calcularISRMensual: () => 100 }));
import { query, getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { aplicarCuotasElegibles, sumaCuotasAplicadasPorPeriodo } from "./descuentos";
import { aplicarHorasExtraElegibles, sumaHorasExtraAplicadasPorPeriodo } from "./horas-extra";
import { generarLineasPeriodo, actualizarLinea, marcarPagos, actualizarEstadoPeriodo, cancelarPeriodo } from "./planillas";
const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const periodo = { id: 1, codigo: "PRUEBA", fecha_inicio: "2026-08-01", fecha_fin: "2026-08-15", estado: "Generada", tipo_periodo: "QUINCENA_1", mes: 8, anio: 2026 };
const empleado = { id: 7, codigo: "PRUEBA", nombre: "Empleado ficticio", sueldo_base: 4000, bono_incentivo: 250, bono_herramientas: 0 };
let prev: Record<string, unknown>[];
let estado: string;
let q1: Record<string, unknown>[];
const generar = (conservarPagos = true) => generarLineasPeriodo(3, 1, { usuario: "prueba", conservarPagos });
beforeEach(() => {
  vi.resetAllMocks();
  prev = []; estado = "Generada";
  q1 = [];
  periodo.tipo_periodo = "QUINCENA_1";
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  vi.mocked(query).mockImplementation(async (sql) => {
    if (sql.includes("FROM rrhh_planilla_periodos")) return [periodo] as never;
    if (sql.includes("FROM empleados")) return [empleado] as never;
    return [] as never;
  });
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT estado FROM rrhh_planilla_periodos")) return [[{ estado }], []];
    if (sql.includes("SELECT * FROM rrhh_planilla_lineas")) return [prev, []];
    if (sql.includes("INNER JOIN rrhh_planilla_lineas")) return [q1, []];
    return [[], []];
  });
  conn.execute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("INSERT INTO rrhh_planilla_lineas")) {
      const keys = ["empresa_id", "periodo_id", "id_empleado", "codigo_empleado", "nombre_empleado", "dpi", "tipo_contrato", "forma_pago", "sueldo_base", "bono_incentivo", "bono_herramientas", "otros_ingresos", "igss_laboral", "igss_patronal", "descuentos", "isr", "neto", "estado_pago", "ref_pago"];
      const row = Object.fromEntries(keys.map((key, i) => [key, params[i]]));
      prev = [{ ...row, id: prev[0]?.id ?? 50, notas: prev[0]?.notas ?? "" }];
    }
    return [{ affectedRows: 1 }, []];
  });
  vi.mocked(aplicarCuotasElegibles).mockResolvedValue({ aplicadas: 0, totalAplicado: 0 });
  vi.mocked(sumaCuotasAplicadasPorPeriodo).mockResolvedValue(new Map([[7, 150]]));
  vi.mocked(aplicarHorasExtraElegibles).mockResolvedValue({ aplicadas: 0, totalHoras: 0, totalMonto: 0 });
  vi.mocked(sumaHorasExtraAplicadasPorPeriodo).mockResolvedValue(new Map());
});
describe("controles compartidos de planilla", () => {
  it("cancela sin borrar líneas y audita antes del commit", async () => {
    expect(await cancelarPeriodo(3, 1, "Prueba", "prueba")).toEqual({ ok: true });
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("DELETE"))).toBe(false);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 3, usuario: "prueba", accion: "cancelar_periodo_planilla",
    }));
    expect(conn.commit).toHaveBeenCalledOnce();
  });
  it("revierte toda la transacción si falla la auditoría", async () => {
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("Auditoría no disponible"));
    await expect(cancelarPeriodo(3, 1, "Prueba", "prueba")).rejects.toThrow("Auditoría");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it("bloquea cancelación con pagos antes de liberar cuotas", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT estado")) return [[{ estado: "Generada" }], []];
      if (sql.includes("estado_pago = 'Pagado'")) return [[{ id: 50 }], []];
      throw new Error("No debe consultar reservas");
    });
    expect(await cancelarPeriodo(3, 1, "Prueba", "prueba")).toMatchObject({ ok: false });
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("exige motivo sin iniciar transacción", async () => {
    expect(await cancelarPeriodo(3, 1, " ", "prueba")).toMatchObject({ motivo: "motivo_requerido" });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it("valida período y línea antes de modificar", async () => {
    expect(await actualizarLinea(3, 1, 99, { isr: 5 })).toBeNull();
    expect(conn.query.mock.calls[1]).toEqual([expect.stringContaining("periodo_id = ? AND id = ? FOR UPDATE"), [3, 1, 99]]);
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("no desmarca un pago por edición ni en lote", async () => {
    prev = [{ id: 50, id_empleado: 7, estado_pago: "Pagado" }];
    await expect(actualizarLinea(3, 1, 50, { estadoPago: "Pendiente" })).rejects.toThrow("reversión explícita");
    await expect(marcarPagos(3, 1, { estadoPago: "Pendiente" })).rejects.toThrow("reversión explícita");
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("no paga ni reabre un periodo cancelado", async () => {
    estado = "Cancelado";
    await expect(marcarPagos(3, 1, { estadoPago: "Pagado" })).rejects.toThrow("no permite");
    await expect(actualizarEstadoPeriodo(3, 1, "Generada")).rejects.toThrow("no permitida");
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("no cierra una planilla sin líneas", async () => {
    await expect(actualizarEstadoPeriodo(3, 1, "Cerrada")).rejects.toThrow("sin líneas");
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("paga una planilla cerrada bajo el mismo lock del período", async () => {
    estado = "Cerrada";
    expect(await marcarPagos(3, 1, { estadoPago: "Pagado", soloPendientes: true })).toBe(1);
    expect(conn.query.mock.calls[0]).toEqual([expect.stringContaining("FOR UPDATE"), [1, 3]]);
    expect(conn.execute.mock.calls[0][0]).toContain("estado_pago = 'Pendiente'");
    expect(conn.commit).toHaveBeenCalledOnce();
  });
  it("no cancela una planilla cerrada", async () => {
    estado = "Cerrada";
    expect(await cancelarPeriodo(3, 1, "Prueba", "prueba")).toMatchObject({ ok: false, motivo: "estado_no_permite" });
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("rechaza cambio económico en una planilla cerrada", async () => {
    estado = "Cerrada";
    prev = [{ id: 50, id_empleado: 7, periodo_id: 1, isr: 50, estado_pago: "Pendiente" }];
    await expect(actualizarLinea(3, 1, 50, { isr: 60 })).rejects.toThrow("No se pueden cambiar importes");
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
});
describe("regeneración segura de planilla", () => {
  it("segunda quincena sin primera solo cobra la mitad mensual", async () => {
    periodo.tipo_periodo = "QUINCENA_2";
    const result = await generar();
    expect(result.empleadosSinIgssQ1).toBe(1);
    expect(prev[0]).toMatchObject({ sueldo_base: 2000, bono_incentivo: 125, igss_laboral: 96.6, igss_patronal: 253.4, isr: 50 });
  });
  it("segunda quincena concilia contra los importes persistidos de primera", async () => {
    periodo.tipo_periodo = "QUINCENA_2";
    q1 = [{ id_empleado: 7, sueldo_base: 1999.99, bono_incentivo: 125.01,
      bono_herramientas: 0, igss_laboral: 96.59, igss_patronal: 253.39, isr: 35 }];
    await generar();
    expect(prev[0]).toMatchObject({ sueldo_base: 2000.01, bono_incentivo: 124.99,
      igss_laboral: 96.61, igss_patronal: 253.41, isr: 65 });
    const lectura = conn.query.mock.calls.find(([sql]) => sql.includes("INNER JOIN rrhh_planilla_lineas"));
    expect(lectura).toEqual([expect.stringContaining("FOR UPDATE"), [3, 8, 2026]]);
    prev[0].isr = 60;
    await generar();
    expect(prev[0].isr).toBe(60); // ajuste manual del período, no se divide de nuevo
  });
  it("rechaza dos primeras quincenas para el mismo empleado", async () => {
    periodo.tipo_periodo = "QUINCENA_2";
    q1 = [{ id_empleado: 7 }, { id_empleado: 7 }];
    await expect(generar()).rejects.toThrow("más de una primera quincena");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it.each([
    { sueldo_base: 4001 }, { bono_incentivo: 251 }, { bono_herramientas: 1 },
    { igss_laboral: 194 }, { igss_patronal: 508 }, { isr: 101 },
  ])("rechaza saldo negativo al conciliar %j", async (importe) => {
    periodo.tipo_periodo = "QUINCENA_2";
    q1 = [{ id_empleado: 7, ...importe }];
    await expect(generar()).rejects.toThrow("negativo o inválido");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO rrhh_planilla_lineas"))).toBe(false);
  });
  it("tres generaciones conservan descuento, ISR, referencia, notas e ID", async () => {
    await generar();
    const neto = prev[0].neto;
    prev[0].ref_pago = "referencia"; prev[0].notas = "nota";
    await generar(false); await generar();
    expect(prev[0]).toMatchObject({ id: 50, descuentos: 150, isr: 50, neto, estado_pago: "Pendiente", ref_pago: "referencia", notas: "nota" });
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("DELETE"))).toBe(false);
    expect(conn.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO rrhh_planilla_lineas"))?.[0]).toContain("ON DUPLICATE KEY UPDATE");
    expect(conn.commit).toHaveBeenCalledTimes(3);
  });
  it.each([true, false])("no regenera pagos existentes, conservarPagos=%s", async (conservar) => {
    prev = [{ id: 50, id_empleado: 7, estado_pago: "Pagado" }];
    await expect(generar(conservar)).rejects.toThrow("pagos registrados");
    expect(aplicarCuotasElegibles).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
  it("revalida el estado después de bloquear el período", async () => {
    estado = "Cerrada";
    await expect(generar()).rejects.toThrow("ya no está abierto");
    expect(conn.query.mock.calls[0]).toEqual([expect.stringContaining("FOR UPDATE"), [1, 3]]);
    expect(aplicarCuotasElegibles).not.toHaveBeenCalled();
  });
  it("no borra líneas de empleados que dejaron de estar activos", async () => {
    prev = [{ id: 50, id_empleado: 99, estado_pago: "Pendiente" }];
    await expect(generar()).rejects.toThrow("ya no están activos");
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("revierte si una cuota aplicada quedaría sin empleado en planilla", async () => {
    vi.mocked(sumaCuotasAplicadasPorPeriodo).mockResolvedValue(new Map([[99, 150]]));
    await expect(generar()).rejects.toThrow("Una cuota corresponde");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("revierte si falla guardar líneas tras aplicar cuotas", async () => {
    conn.execute.mockRejectedValue(new Error("fallo simulado"));
    await expect(generar()).rejects.toThrow("fallo simulado");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
});
