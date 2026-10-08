import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const m = await import("./vacaciones-registro-bd.testutil");
  return {
    query: (sql: string, p?: unknown[]) => m.bd.consulta(sql, p),
    execute: async () => { throw new Error("no usar execute del pool"); },
    getPool: () => ({ getConnection: async () => m.bd.conexion() }),
  };
});

import { bd, EMPRESA } from "./vacaciones-registro-bd.testutil";
import { obtenerHistorialPeriodos } from "./vacaciones";
import { registrarVacaciones } from "./vacaciones-registro";
import { cambiarModoCargaHistorica, leerModoCargaHistorica } from "./vacaciones-modo-db";
import { previsualizarActivacionModoHistorico } from "./vacaciones-modo-preflight-db";
import { evaluarConsumoVerificable } from "./vacaciones-modo-preflight";
import { resincronizarSaldosEmpresa } from "./vacaciones-modo-resync-db";

/**
 * PREFLIGHT del modo de carga histórica. En modo carga el saldo se reconstruye como `otorgados − Σ detalle FIFO`; si existe consumo SIN detalle verificable eso INVENTARÍA días.
 * Por eso activar exige un preflight de solo lectura sin ningún colaborador con consumo no verificable. Datos sintéticos: fecha_alta 13/04/2023, "hoy" 08/10/2026.
 */
const EMP = 1;
const OTRO = 2;
const OTRA_EMPRESA = 8;
const ALTA = "2023-04-13";
const r2 = (n: number) => Math.round(n * 100) / 100;
const hoyFijo = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 8, 12)); };
const emp = (id: number, empresa = EMPRESA) => ({ id, empresa_id: empresa, nombre: `Colaborador ${id}`, fecha_alta: ALTA });
const inc = (id: number, ini: string, fin: string, dias: number, e = EMP, empresa = EMPRESA) => ({ id, empresa_id: empresa, id_empleado: e, tipo: "Vacaciones", fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias });
const vac = (id: number, ini: string, fin: string, dias: number, e = EMP, empresa = EMPRESA) => ({ id, empresa_id: empresa, id_empleado: e, fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias, estado: "Aprobado" });
const periodos = (id = EMP, empresa = EMPRESA) => bd.t.saldos.filter((s) => s.id_empleado === id && s.empresa_id === empresa).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));
const saldo = async (id = EMP, empresa = EMPRESA) => (await obtenerHistorialPeriodos(empresa, id)).saldoActual;
const activar = (empresa = EMPRESA) => cambiarModoCargaHistorica(empresa, true, { usuario: "rrhh.ana" });
const reg = (inicio: string, fin: string, dias: number) => registrarVacaciones({ empresaId: EMPRESA, idEmpleado: EMP, fechaInicio: inicio, fechaFin: fin, diasATomar: dias, tipo: "Vacaciones", usuario: "rrhh.ana" });
const sinEscrituras = () => bd.ejecutadas.every((s) => !/^(INSERT|UPDATE|DELETE)/.test(s));
const codigos = (p: Awaited<ReturnType<typeof previsualizarActivacionModoHistorico>>, e = EMP) => p.motivos.find((m) => m.empleadoId === e)?.motivos.map((x) => x.codigo) ?? [];

beforeEach(() => { hoyFijo(); bd.reiniciar({ empleados: [emp(EMP), emp(OTRO)] }); });
afterEach(() => vi.useRealTimers());

describe("A/K) colaborador limpio: apto, se activa y pasa de 30 a 52.38", () => {
  it("sin vacaciones antiguas: preflight apto (solo lectura), activación permitida, 30 → 52.38 (15 + 15 + 15 + 7.38)", async () => {
    expect(await saldo()).toBe(30);
    const p = await previsualizarActivacionModoHistorico(EMPRESA);
    expect(p).toMatchObject({ puedeActivar: true, bloqueados: 0, motivos: [] });
    expect(p.revisados).toBe(p.aptos);
    const r = await activar();
    expect(r).toMatchObject({ cambiado: true, valorNuevo: true });
    expect(r.preflight).toBeUndefined();
    expect(await leerModoCargaHistorica(EMPRESA)).toBe(true);
    expect(await saldo()).toBe(52.38);
    expect(periodos().map((s) => s.dias_disponibles)).toEqual([15, 15, 15, 7.38]);
  });
  it("B) vacación histórica con detalle FIFO completo (registrada por el flujo normal): apto; al activar el consumo se conserva (42.38)", async () => {
    await saldo();
    expect((await reg("2024-02-05", "2024-02-16", 10)).ok).toBe(true);
    const p = await previsualizarActivacionModoHistorico(EMPRESA);
    expect(p).toMatchObject({ puedeActivar: true, bloqueados: 0 });
    await activar();
    expect(await saldo()).toBe(42.38);
    for (const s of periodos()) {
      const consumido = bd.t.detalle.filter((d) => d.saldo_id === s.id).reduce((a, d) => a + d.dias_tomados, 0);
      expect(s.dias_disponibles).toBeLessThanOrEqual(r2(s.dias_otorgados - consumido) + 0.004); // I) nada consumido reaparece
    }
  });
});

describe("C/D/E) consumo no verificable ⇒ el preflight bloquea y NO se cambia nada", () => {
  const verificarBloqueo = async (esperados: string[]) => {
    const antes = bd.instantanea();
    const p = await previsualizarActivacionModoHistorico(EMPRESA);
    expect(p.puedeActivar).toBe(false);
    expect(p.bloqueados).toBeGreaterThanOrEqual(1);
    expect(codigos(p)).toEqual(expect.arrayContaining(esperados));
    expect(JSON.stringify(p)).not.toMatch(/SELECT|FROM |INSERT/i); // mensajes seguros, sin SQL
    bd.eventos = [];
    const r = await activar();
    expect(r.cambiado).toBe(false);
    expect(r.preflight!.puedeActivar).toBe(false);
    expect(r.valorNuevo).toBe(false);
    expect(await leerModoCargaHistorica(EMPRESA)).toBe(false); // la bandera sigue NORMAL
    expect(bd.t.configuracion).toEqual([]);
    expect(bd.t.auditoria.some((a) => a.accion === "vacaciones_modo_historico_activado")).toBe(false);
    expect(bd.instantanea()).toEqual(antes); // saldos y todo lo demás intacto
    expect(bd.eventos).toContain("ROLLBACK");
  };

  it("C) vacación con días tomados y SIN detalle FIFO (caso del bloqueante: otorgados 15, disponibles 5, sin detalle) ⇒ bloquea y el saldo no se infla", async () => {
    await saldo();
    const p1 = periodos()[1]; p1.dias_disponibles = 5; // saldo previamente reducido
    bd.t.incidencias.push(inc(10, "2024-08-05", "2024-08-16", 10));
    bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-16", 10));
    await verificarBloqueo(["SIN_DETALLE"]);
    expect(periodos()[1].dias_disponibles).toBe(5); // jamás se reconstruye a 15
  });
  it("D) detalle PARCIAL (suma menos que los días tomados) ⇒ bloquea", async () => {
    await saldo();
    bd.t.incidencias.push(inc(10, "2024-08-05", "2024-08-16", 10));
    bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-16", 10));
    bd.t.detalle.push({ id: 1, incidencia_id: 10, saldo_id: periodos()[1].id, dias_tomados: 4 });
    await verificarBloqueo(["DETALLE_PARCIAL"]);
  });
  it("E) detalle CRUZADO (de otro colaborador, de otra empresa o inexistente), AJENO y HUÉRFANO ⇒ bloquea", async () => {
    await saldo(); await saldo(OTRO);
    bd.t.incidencias.push(inc(10, "2024-08-05", "2024-08-09", 5), inc(20, "2024-08-05", "2024-08-09", 5, OTRO));
    bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-09", 5), vac(20, "2024-08-05", "2024-08-09", 5, OTRO));
    // 1) línea de la vacación de EMP apuntando al saldo de OTRO
    bd.t.detalle.push({ id: 1, incidencia_id: 10, saldo_id: periodos(OTRO)[1].id, dias_tomados: 5 });
    // 2) línea de la vacación de OTRO sobre un saldo de EMP (ajeno)
    bd.t.detalle.push({ id: 2, incidencia_id: 20, saldo_id: periodos(EMP)[1].id, dias_tomados: 5 });
    // 3) línea sobre un saldo de EMP sin incidencia (huérfano)
    bd.t.detalle.push({ id: 3, incidencia_id: 999, saldo_id: periodos(EMP)[2].id, dias_tomados: 1 });
    const p = await previsualizarActivacionModoHistorico(EMPRESA);
    expect(codigos(p, EMP)).toEqual(expect.arrayContaining(["DETALLE_SALDO_AJENO", "DETALLE_AJENO", "DETALLE_HUERFANO"]));
    expect(p.puedeActivar).toBe(false);
    await verificarBloqueo(["DETALLE_SALDO_AJENO"]);
  });
  it("detalle hacia saldo de OTRA empresa o inexistente ⇒ bloquea", async () => {
    bd.reiniciar({ empleados: [emp(EMP), emp(50, OTRA_EMPRESA)] });
    await saldo(); await saldo(50, OTRA_EMPRESA);
    bd.t.incidencias.push(inc(10, "2024-08-05", "2024-08-09", 5));
    bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-09", 5));
    bd.t.detalle.push({ id: 1, incidencia_id: 10, saldo_id: periodos(50, OTRA_EMPRESA)[1].id, dias_tomados: 5 });
    await verificarBloqueo(["DETALLE_SALDO_AJENO"]);
    bd.t.detalle[0].saldo_id = 9999; // inexistente
    expect(codigos(await previsualizarActivacionModoHistorico(EMPRESA))).toContain("DETALLE_SALDO_AJENO");
  });
  it("una fila del historial simple (`vacaciones`) sin incidencia ni detalle que la respalde ⇒ bloquea", async () => {
    await saldo();
    bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-09", 5));
    await verificarBloqueo(["VACACION_SIN_INCIDENCIA"]);
  });
  it("la lista de bloqueados muestra empleado y motivo, y solo los bloqueados (el resto cuenta como apto)", async () => {
    await saldo(); await saldo(OTRO);
    bd.t.incidencias.push(inc(10, "2024-08-05", "2024-08-09", 5)); bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-09", 5));
    const p = await previsualizarActivacionModoHistorico(EMPRESA);
    expect(p).toMatchObject({ revisados: 2, aptos: 1, bloqueados: 1, puedeActivar: false });
    expect(p.motivos).toEqual([expect.objectContaining({ empleadoId: EMP, nombre: "Colaborador 1", motivos: [expect.objectContaining({ codigo: "SIN_DETALLE" })] })]);
  });
});

describe("F/G) otra empresa no afecta; desactivar siempre es posible", () => {
  it("F) una anomalía en OTRA empresa no bloquea ni cambia a esta; y se bloquea solo para la que la tiene", async () => {
    bd.reiniciar({ empleados: [emp(EMP), emp(50, OTRA_EMPRESA)] });
    await saldo(); await saldo(50, OTRA_EMPRESA);
    bd.t.incidencias.push(inc(30, "2024-08-05", "2024-08-09", 5, 50, OTRA_EMPRESA));
    bd.t.vacaciones.push(vac(30, "2024-08-05", "2024-08-09", 5, 50, OTRA_EMPRESA));
    expect((await previsualizarActivacionModoHistorico(EMPRESA)).puedeActivar).toBe(true);
    expect((await previsualizarActivacionModoHistorico(OTRA_EMPRESA)).puedeActivar).toBe(false);
    expect((await activar(EMPRESA)).cambiado).toBe(true);
    expect((await activar(OTRA_EMPRESA)).cambiado).toBe(false);
    expect(await leerModoCargaHistorica(OTRA_EMPRESA)).toBe(false);
    expect(bd.t.configuracion.map((c) => c.empresa_id)).toEqual([EMPRESA]);
  });
  it("G) volver a NORMAL sigue permitido aunque aparezca después una anomalía (el preflight solo aplica al activar)", async () => {
    await saldo();
    await activar();
    bd.t.incidencias.push(inc(10, "2024-08-05", "2024-08-16", 10)); // anomalía posterior: consumo sin detalle
    bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-16", 10));
    const r = await cambiarModoCargaHistorica(EMPRESA, false, { usuario: "rrhh.ana" });
    expect(r).toMatchObject({ cambiado: true, valorNuevo: false });
    expect(r.preflight).toBeUndefined();
    expect(await leerModoCargaHistorica(EMPRESA)).toBe(false);
  });
  it("activar cuando ya está activo es idempotente y no vuelve a ejecutar el preflight", async () => {
    await activar();
    bd.ejecutadas = [];
    expect((await activar()).cambiado).toBe(false);
    expect(bd.ejecutadas.some((s) => s.includes("FROM saldos_vacaciones"))).toBe(false);
  });
});

describe("H/I) defensa en profundidad con el modo YA activo: resincronización", () => {
  it("un colaborador con consumo no verificable NO se recalcula (CONSUMO_NO_VERIFICABLE), no se infla su saldo y los demás continúan", async () => {
    await saldo(); await saldo(OTRO); // series creadas en modo normal (año 1 Vencido/0, tope aplicado)
    bd.t.incidencias.push(inc(20, "2024-08-05", "2024-08-16", 10, OTRO));
    bd.t.vacaciones.push(vac(20, "2024-08-05", "2024-08-16", 10, OTRO)); // OTRO: consumo SIN detalle
    periodos(OTRO)[1].dias_disponibles = 5;
    bd.t.configuracion.push({ empresa_id: EMPRESA, parametro: "vacaciones_modo_carga_historica", valor: "1" }); // modo ya activo
    const antesOtro = JSON.stringify(periodos(OTRO));
    const r = await resincronizarSaldosEmpresa(EMPRESA, { usuario: "rrhh.ana" });
    expect(r).toMatchObject({ total: 2, sincronizados: 1, consumoNoVerificable: 1, congelados: 0, errores: 0 });
    expect(r.resultados).toEqual([{ empleadoId: EMP, resultado: "SINCRONIZADO" }, { empleadoId: OTRO, resultado: "CONSUMO_NO_VERIFICABLE" }]);
    expect(JSON.stringify(periodos(OTRO))).toBe(antesOtro); // ese colaborador no cambia (ni un día)
    expect(periodos(EMP).map((s) => s.dias_disponibles)).toEqual([15, 15, 15, 7.38]); // el otro sí se rehabilita
    expect(JSON.parse(bd.t.auditoria.find((a) => a.accion === "vacaciones_resincronizacion_modo")!.detalle!)).toMatchObject({ sincronizados: 1, consumoNoVerificable: 1, errores: 0 });
  });
  it("incluso la sincronización perezosa (consultar al colaborador) respeta la defensa: no restaura lo no verificable", async () => {
    await saldo();
    bd.t.incidencias.push(inc(10, "2024-08-05", "2024-08-16", 10));
    bd.t.vacaciones.push(vac(10, "2024-08-05", "2024-08-16", 10));
    periodos()[1].dias_disponibles = 5;
    bd.t.configuracion.push({ empresa_id: EMPRESA, parametro: "vacaciones_modo_carga_historica", valor: "1" });
    expect(await saldo()).toBe(27.38); // sigue como estaba (5 + 15 + 7.38): NO se infla a 52.38
    expect(periodos()[1].dias_disponibles).toBe(5);
  });
});

describe("J) el preflight es SOLO LECTURA", () => {
  it("solo SELECT: sin INSERT/UPDATE/DELETE, sin transacciones y sin tocar ninguna tabla", async () => {
    await saldo();
    await reg("2024-02-05", "2024-02-16", 10);
    bd.t.vacaciones.push(vac(99, "2024-08-05", "2024-08-09", 5)); // incluso con anomalías
    const antes = bd.instantanea();
    bd.ejecutadas = []; bd.eventos = [];
    const p = await previsualizarActivacionModoHistorico(EMPRESA);
    expect(p.puedeActivar).toBe(false);
    expect(bd.ejecutadas.length).toBeGreaterThan(0);
    expect(bd.ejecutadas.every((s) => s.startsWith("SELECT"))).toBe(true);
    expect(sinEscrituras()).toBe(true);
    expect(bd.eventos).toEqual([]);
    expect(bd.instantanea()).toEqual(antes);
  });
});

describe("evaluarConsumoVerificable (puro)", () => {
  const h = (incidenciaId: number, dias: number, consumido: number) => ({ incidenciaId, tipo: "Vacaciones", inicio: "2024-08-05", fin: "2024-08-09", dias, consumido });
  it("apto con detalle completo (o sin vacaciones); no infiere consumo desde dias_disponibles; un detalle mayor que los días no es una inflación", () => {
    expect(evaluarConsumoVerificable({ hechos: [], cruzados: [], ajenos: [], espejos: [] })).toEqual([]);
    expect(evaluarConsumoVerificable({ hechos: [h(1, 5, 5)], cruzados: [], ajenos: [], espejos: [{ inicio: "2024-08-05", fin: "2024-08-09", dias: 5 }] })).toEqual([]);
    expect(evaluarConsumoVerificable({ hechos: [h(1, 5, 6)], cruzados: [], ajenos: [], espejos: [] })).toEqual([]);
  });
  it("distingue sin detalle, parcial, cruzado, ajeno, huérfano y espejo sin respaldo", () => {
    const m = evaluarConsumoVerificable({
      hechos: [h(1, 5, 0), h(2, 10, 4)], cruzados: [{ incidenciaId: 3, saldoId: 9 }],
      ajenos: [{ detalleId: 1, incidenciaId: 7, existeIncidencia: true }, { detalleId: 2, incidenciaId: 8, existeIncidencia: false }],
      espejos: [{ inicio: "2020-01-01", fin: "2020-01-05", dias: 5 }],
    }).map((x) => x.codigo);
    expect(m).toEqual(["SIN_DETALLE", "DETALLE_PARCIAL", "DETALLE_SALDO_AJENO", "DETALLE_AJENO", "DETALLE_HUERFANO", "VACACION_SIN_INCIDENCIA"]);
  });
});
