import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("./isr", () => ({ calcularISRMensual: () => 999 }));
vi.mock("./fiscal-antecedentes", () => ({ leerAntecedentesFiscalesTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { leerAntecedentesFiscalesTx } from "./fiscal-antecedentes";
import { generarLineasPeriodo, autorizarPeriodoPlanilla } from "./planillas";
import { leerConceptosSnapshot } from "./planilla-conceptos";
import { DIVISOR_FALTA_DEFAULT } from "./config";

/**
 * RRHH-TOMAR-ASISTENCIA-2 — integración REAL con planilla: se ejecutan
 * generarLineasPeriodo / autorizarPeriodoPlanilla (y el motor ISR 2026, sin
 * mockear) sobre una base simulada. Prueba que una ausencia CONFIRMADA por
 * RRHH entra como concepto de descuento (sueldo base ÷ divisor), que solo la
 * ausencia CONFIRMADA y aún aplicable descuenta, que IGSS/ISR no cambian y
 * que las planillas autorizadas/cerradas no se alteran.
 */
type Row = Record<string, unknown>;
type Aus = { id: number; empleado_id: number; fecha: string; estado: string; planilla_periodo_id: number | null; monto_aplicado?: number };

let periodo: Row;
let lineas: Row[];
let sueldo: number;
let bonoIncentivo: number;
let tipoContrato: string;
let estadoEmpleado: string;
let tipoHorario: string;
let fechaEgreso: string | null;
let ausencias: Aus[];
let sesiones: Row[];
let incidencias: Row[];
let enRuta: Row[];
let feriados: string[];
let divisorConfig: string | null;
let sinTablaAusencias: boolean;
let backup: string;
const conn = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), query: vi.fn(), execute: vi.fn() };
const generar = () => generarLineasPeriodo(3, 1, { usuario: "prueba" });
const autorizar = () => autorizarPeriodoPlanilla(3, 1, "gerente");
const falta = (id: number, fecha: string, extra: Partial<Aus> = {}): Aus => ({ id, empleado_id: 7, fecha, estado: "CONFIRMADA", planilla_periodo_id: null, ...extra });
const linea = () => lineas[0] as Record<string, number | string>;
const snapshot = () => leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
const errTabla = () => Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });

beforeEach(() => {
  vi.resetAllMocks();
  sueldo = 4000; bonoIncentivo = 0; tipoContrato = "fijo"; estadoEmpleado = "Activo"; tipoHorario = "Fijo"; fechaEgreso = null;
  lineas = []; ausencias = []; sesiones = []; incidencias = []; enRuta = []; feriados = []; divisorConfig = null; sinTablaAusencias = false;
  periodo = { id: 1, empresa_id: 3, codigo: "PRUEBA", estado: "Borrador", autorizado_en: null, autorizado_por: null,
    fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30", tipo_periodo: "MENSUAL", mes: 9, anio: 2026 };
  vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({
    ultima: null, revisiones: [],
    confirmada: { id: 1, revision: 1, creadoPor: "rrhh", creadoEn: "2026-01-01", confirmadoPor: "rrhh", confirmadoEn: "2026-01-02",
      inicioFiscal: null, corteAntecedentes: null, ingresosGravadosPrevios: null, ingresosExentosPrevios: null, igssLaboralPrevio: null, isrRetenidoPrevio: null,
      datos: { version: 1, declaracionAntecedentes: "SIN_ANTECEDENTES", constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [], otrosPatronos: { declaracion: "NO", agenteRetenedor: "PENDIENTE", remuneraciones: [] } } },
  } as never);
  conn.beginTransaction.mockImplementation(async () => { backup = JSON.stringify({ periodo, lineas, ausencias }); });
  conn.rollback.mockImplementation(async () => { ({ periodo, lineas, ausencias } = JSON.parse(backup)); });
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  const empleadoRow = () => ({ id: 7, codigo: "E7", nombre: "Empleado", tipo_contrato: tipoContrato, sueldo_base: sueldo, bono_incentivo: bonoIncentivo, bono_herramientas: 0 });
  vi.mocked(query).mockImplementation(async (sql) => {
    if (sql.includes("FROM rrhh_planilla_periodos")) return [periodo] as never;
    if (sql.includes("FROM empleados")) return (estadoEmpleado === "Activo" ? [empleadoRow()] : []) as never;
    if (sql.includes("FROM feriados")) return feriados.map((f) => ({ fecha: f })) as never;
    return [] as never;
  });
  conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
    // --- tablas de asistencia (RRHH-TOMAR-ASISTENCIA-2) ---
    if (sql.includes("FROM rrhh_asistencia_ausencias")) {
      if (sinTablaAusencias) throw errTabla();
      if (sql.includes("planilla_periodo_id = ? LIMIT 1")) return [ausencias.filter((a) => a.planilla_periodo_id === Number(params[1])).slice(0, 1), []];
      const [, ini, fin] = params as [number, string, string];
      return [ausencias
        .filter((a) => a.estado === "CONFIRMADA" && a.planilla_periodo_id == null && a.fecha >= ini && a.fecha <= fin && estadoEmpleado === "Activo")
        .map((a) => ({ ...a, sueldo_base: sueldo, tipo_horario: tipoHorario, fecha_alta: "2020-01-01", fecha_egreso: fechaEgreso })), []];
    }
    if (sql.includes("FROM sesiones_trabajo")) return [sesiones, []];
    if (sql.includes("FROM incidencias")) return [incidencias, []];
    if (sql.includes("FROM marcajes_en_ruta")) return [enRuta, []];
    if (sql.includes("FROM configuracion")) return [divisorConfig == null ? [] : [{ valor: divisorConfig }], []];
    // --- planilla existente (mismo emulador que planillas-fiscal-2026-integracion) ---
    if (sql.includes("p.autorizado_en IS NOT NULL")) return [[], []];
    if (sql.includes("INNER JOIN rrhh_planilla_lineas")) return [[], []];
    if (sql.includes("FROM empleados")) return [Number(params[0]) === 3 && params.slice(1).includes(7) ? [{ id: 7, codigo: "E7", sueldo_base: sueldo, bono_incentivo: bonoIncentivo, bono_herramientas: 0 }] : [], []];
    if (sql.includes("SELECT id, estado FROM")) return [Number(params[0]) === 3 ? [periodo] : [], []];
    if (sql.includes("SELECT q2.id")) return [[], []];
    if (sql.includes("SELECT autorizado_en") || sql.includes("SELECT * FROM rrhh_planilla_periodos")) return [[periodo], []];
    if (sql.includes("FROM rrhh_planilla_lineas")) return [lineas, []];
    return [[], []];
  });
  conn.execute.mockImplementation(async (sql: string, p: unknown[]) => {
    if (sql.includes("INSERT INTO rrhh_planilla_lineas")) {
      const keys = ["empresa_id", "periodo_id", "id_empleado", "codigo_empleado", "nombre_empleado", "dpi", "tipo_contrato", "forma_pago", "sueldo_base", "bono_incentivo", "bono_herramientas", "otros_ingresos", "igss_laboral", "igss_patronal", "descuentos", "isr", "neto", "estado_pago", "ref_pago", "conceptos_snapshot"];
      lineas = [{ ...Object.fromEntries(keys.map((k, i) => [k, p[i]])), id: lineas[0]?.id ?? 100 }];
    } else if (sql.includes("UPDATE rrhh_asistencia_ausencias")) {
      const [periodoId, monto, , , id, empleadoId] = p as [number, number, string, number, number, number];
      const a = ausencias.find((x) => x.id === id && x.empleado_id === empleadoId && x.estado === "CONFIRMADA" && x.planilla_periodo_id == null);
      if (!a) return [{ affectedRows: 0 }, []];
      a.planilla_periodo_id = periodoId; a.monto_aplicado = monto;
    } else if (sql.includes("UPDATE rrhh_planilla_periodos")) {
      if (sql.includes("autorizado_en = NOW()")) { periodo.estado = "Cerrada"; periodo.autorizado_por = p[0]; periodo.autorizado_en = "2026-09-30 12:00:00"; }
      else periodo.estado = "Generada";
    }
    return [{ affectedRows: 1 }, []];
  });
});

describe("una falta CONFIRMADA descuenta en planilla abierta (sueldo base ÷ divisor)", () => {
  it("entra como descuento identificable: Q133.33 = 4000 ÷ 30; sueldo base, bonos, IGSS e ISR NO cambian; neto baja exactamente ese monto", async () => {
    await generar();
    const base = { ...linea() };
    expect(Number(base.descuentos)).toBe(0);
    expect("faltas" in snapshot()).toBe(false); // sin faltas el snapshot es idéntico al histórico

    ausencias = [falta(1, "2026-09-23")];
    await generar();
    const l = linea();
    expect(Number(l.descuentos)).toBe(133.33);
    expect(Number(l.sueldo_base)).toBe(4000);
    expect(Number(l.bono_incentivo)).toBe(Number(base.bono_incentivo));
    expect(Number(l.igss_laboral)).toBe(Number(base.igss_laboral)); // IGSS intacto
    expect(Number(l.igss_patronal)).toBe(Number(base.igss_patronal));
    expect(Number(l.isr)).toBe(Number(base.isr)); // ISR 2026 intacto (el motor no lee descuentos)
    expect(Number(l.neto)).toBeCloseTo(Number(base.neto) - 133.33, 2);
    const f = snapshot().faltas!;
    expect(f).toEqual([expect.objectContaining({ id: 1, monto: 133.33, concepto: "Falta injustificada 23/09/2026", fecha: "2026-09-23" })]);
    expect(f[0].notas).toContain("÷ 30");
  });

  it("ISR 2026 con retención REAL (>0): la falta no lo modifica (sueldo 30,000: descuento 1,000.00)", async () => {
    sueldo = 30000;
    await generar();
    const base = { ...linea() };
    expect(Number(base.isr)).toBeGreaterThan(0); // el motor 2026 corre real y retiene
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    expect(Number(linea().isr)).toBe(Number(base.isr));
    expect(Number(linea().igss_laboral)).toBe(Number(base.igss_laboral));
    expect(Number(linea().descuentos)).toBe(1000);
    expect(Number(linea().neto)).toBeCloseTo(Number(base.neto) - 1000, 2);
  });

  it("varias faltas suman: 2 días = 266.66 y cada una conserva su fecha/origen en el snapshot", async () => {
    ausencias = [falta(1, "2026-09-02"), falta(2, "2026-09-23")];
    await generar();
    expect(Number(linea().descuentos)).toBe(266.66);
    expect(snapshot().faltas!.map((f) => f.fecha)).toEqual(["2026-09-02", "2026-09-23"]);
  });

  it("solo SUELDO BASE: el bono incentivo no cambia el monto de la falta", async () => {
    bonoIncentivo = 1000;
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    expect(Number(linea().descuentos)).toBe(133.33);
    expect(snapshot().faltas![0].monto).toBe(133.33);
  });

  it("quincena: la falta se descuenta en la quincena cuya fecha la contiene (no en la otra)", async () => {
    periodo.tipo_periodo = "QUINCENA_1"; periodo.fecha_fin = "2026-09-15";
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    expect(Number(linea().descuentos)).toBe(0); // 23/09 pertenece a Q2
    periodo.fecha_inicio = "2026-09-16"; periodo.fecha_fin = "2026-09-30"; periodo.tipo_periodo = "QUINCENA_2";
    await generar();
    expect(Number(linea().descuentos)).toBe(133.33);
  });

  it("el divisor es configurable (configuracion.divisor_falta) y un valor inválido cae al default único", async () => {
    ausencias = [falta(1, "2026-09-23")];
    divisorConfig = "26";
    await generar();
    expect(Number(linea().descuentos)).toBe(153.85); // 4000 / 26
    divisorConfig = "abc";
    await generar();
    expect(Number(linea().descuentos)).toBe(133.33);
    divisorConfig = "5"; // fuera de 15–31
    await generar();
    expect(Number(linea().descuentos)).toBe(133.33);
    expect(DIVISOR_FALTA_DEFAULT).toBe(30);
  });

  it("el 30 vive en UNA sola constante: planilla-faltas/asistencia no repiten el literal", () => {
    for (const f of ["planilla-faltas.ts", "asistencia-diaria.ts", "planilla-conceptos.ts"]) {
      expect(readFileSync(`src/lib/rrhh/${f}`, "utf8")).not.toMatch(/\/\s*30\b/);
    }
    expect(readFileSync("src/lib/rrhh/config.ts", "utf8")).toContain("DIVISOR_FALTA_DEFAULT = 30");
  });
});

describe("antes del cierre / corregida: NO descuenta", () => {
  it("sin ausencia confirmada (día sin cerrar) no hay descuento", async () => {
    await generar();
    expect(Number(linea().descuentos)).toBe(0);
  });

  it("una ANULADA no descuenta; corregir la falta ANTES de regenerar deja de descontar", async () => {
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    expect(Number(linea().descuentos)).toBe(133.33);
    ausencias[0].estado = "ANULADA"; // RRHH corrigió (marcó presente y volvió a cerrar)
    await generar();
    expect(Number(linea().descuentos)).toBe(0);
    expect("faltas" in snapshot()).toBe(false);
  });
});

describe("se REVALIDA que la falta siga aplicando al generar", () => {
  it.each([
    ["vacaciones", () => { incidencias = [{ id_empleado: 7, fecha_inicio: "2026-09-21", fecha_fin: "2026-09-25" }]; }],
    ["permiso justificado", () => { incidencias = [{ id_empleado: 7, fecha_inicio: "2026-09-23", fecha_fin: "2026-09-23" }]; }],
    ["en ruta", () => { enRuta = [{ id_empleado: 7, fecha_inicio: "2026-09-22", fecha_fin: "2026-09-24" }]; }],
    ["viaje multi-día", () => { sesiones = [{ id_empleado: 7, fecha_jornada: "2026-09-22", salida_at: "2026-09-24 18:00:00" }]; }],
    ["marcaje/jornada registrada después (corrección manual)", () => { sesiones = [{ id_empleado: 7, fecha_jornada: "2026-09-23", salida_at: "2026-09-23 16:00:00" }]; }],
    ["feriado", () => { feriados = ["2026-09-23"]; }],
    ["horario Variable", () => { tipoHorario = "Variable"; }],
    ["fuera de la relación laboral (egreso anterior)", () => { fechaEgreso = "2026-09-10"; }],
  ])("%s -> no descuenta", async (_n, preparar) => {
    ausencias = [falta(1, "2026-09-23")];
    preparar();
    await generar();
    expect(Number(linea().descuentos)).toBe(0);
    expect("faltas" in snapshot()).toBe(false);
  });

  it("domingo -> no descuenta (2026-09-20 es domingo)", async () => {
    ausencias = [falta(1, "2026-09-20")];
    await generar();
    expect(Number(linea().descuentos)).toBe(0);
  });

  it("solo la falta aplicable descuenta cuando hay varias (una cubierta por vacaciones, otra no)", async () => {
    ausencias = [falta(1, "2026-09-22"), falta(2, "2026-09-23")];
    incidencias = [{ id_empleado: 7, fecha_inicio: "2026-09-22", fecha_fin: "2026-09-22" }];
    await generar();
    expect(snapshot().faltas!.map((f) => f.id)).toEqual([2]);
    expect(Number(linea().descuentos)).toBe(133.33);
  });
});

describe("elegibilidad = la de la planilla (no depende del texto del contrato)", () => {
  it("Outsourcing pagado por esta planilla: la falta se descuenta igual (IGSS/ISR siguen en 0 como siempre)", async () => {
    tipoContrato = "outsourcing";
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    expect(Number(linea().descuentos)).toBe(133.33);
    expect(Number(linea().igss_laboral)).toBe(0);
    expect(Number(linea().isr)).toBe(0);
  });

  it("empleado que no participa en la nómina (no Activo): sin línea y sin descuento", async () => {
    estadoEmpleado = "Baja";
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    expect(lineas).toEqual([]);
    expect(ausencias[0].planilla_periodo_id).toBeNull();
  });

  it("si la migración de asistencia no está aplicada la planilla se genera exactamente como antes", async () => {
    sinTablaAusencias = true;
    await generar();
    expect(Number(linea().descuentos)).toBe(0);
    expect(lineas).toHaveLength(1);
  });
});

describe("autorizar aplica la falta una sola vez", () => {
  it("autorizar marca la ausencia con planilla_periodo_id y monto; doble autorización no duplica", async () => {
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    await autorizar();
    expect(periodo.estado).toBe("Cerrada");
    expect(ausencias[0]).toMatchObject({ planilla_periodo_id: 1, monto_aplicado: 133.33 });
    await expect(autorizar()).rejects.toThrow("ya está autorizada");
    expect(ausencias[0].planilla_periodo_id).toBe(1);
    const aplicaciones = conn.execute.mock.calls.filter(([sql]) => String(sql).includes("UPDATE rrhh_asistencia_ausencias"));
    expect(aplicaciones).toHaveLength(1);
  });

  it("si la falta se anula DESPUÉS de generar y ANTES de autorizar, autorizar exige regenerar (no descuenta algo ya corregido)", async () => {
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    ausencias[0].estado = "ANULADA";
    await expect(autorizar()).rejects.toThrow(/cambiaron|Regenera/);
    expect(periodo.estado).not.toBe("Cerrada");
    expect(ausencias[0].planilla_periodo_id).toBeNull();
  });

  it("si aparece una falta nueva después de generar, autorizar exige regenerar (vista previa distinta)", async () => {
    await generar();
    ausencias = [falta(1, "2026-09-23")];
    await expect(autorizar()).rejects.toThrow(/cambiaron|Regenera/);
    expect(ausencias[0].planilla_periodo_id).toBeNull();
  });

  it("una falta que la autorización no logra marcar (ya usada) aborta y hace rollback: ninguna planilla queda a medias", async () => {
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("UPDATE rrhh_asistencia_ausencias")) return [{ affectedRows: 0 }, []];
      return [{ affectedRows: 1 }, []];
    });
    await expect(autorizar()).rejects.toThrow();
    expect(conn.rollback).toHaveBeenCalled();
    expect(periodo.estado).not.toBe("Cerrada");
  });
});

describe("planillas Cerradas/Pagadas no cambian por la asistencia", () => {
  it("planilla autorizada/Cerrada: regenerar se rechaza y las líneas y la falta quedan intactas aunque llegue otra ausencia", async () => {
    ausencias = [falta(1, "2026-09-23")];
    await generar();
    await autorizar();
    const congelada = JSON.stringify(lineas);
    ausencias.push(falta(2, "2026-09-24"));
    await expect(generar()).rejects.toThrow(/cerrada|autorizada/i);
    expect(JSON.stringify(lineas)).toBe(congelada);
    expect(ausencias[1].planilla_periodo_id).toBeNull(); // la nueva NO se arrastra a esta planilla
  });

  it("Pagada/Cancelada: no se regenera", async () => {
    for (const estado of ["Pagada", "Cancelado"]) {
      periodo.estado = estado;
      await expect(generar()).rejects.toThrow();
    }
  });

  it("período con faltas históricas ya aplicadas: exige revisión explícita, como las cuotas", async () => {
    ausencias = [falta(1, "2026-09-23", { planilla_periodo_id: 1 })];
    await expect(generar()).rejects.toThrow("faltas históricas");
    expect(lineas).toEqual([]);
  });

  it("una falta ya aplicada a otro período no vuelve a descontarse en éste", async () => {
    ausencias = [falta(1, "2026-09-23", { planilla_periodo_id: 9 })];
    await generar();
    expect(Number(linea().descuentos)).toBe(0);
  });
});

describe("compatibilidad y detalle visible", () => {
  it("snapshot histórico (sin faltas) sigue siendo válido; con faltas el esquema estricto lo acepta", () => {
    const viejo = { version: 1, empresaId: 3, periodoId: 1, empleadoId: 7, sueldoMensual: 4000, cuotas: [], manuales: [], horasExtra: [], descuentosLegado: [], prestacionesLegado: [] };
    expect(leerConceptosSnapshot(viejo)).not.toBeNull();
    const nuevo = { ...viejo, faltas: [{ id: 1, monto: 133.33, concepto: "Falta injustificada 23/09/2026", fecha: "2026-09-23", notas: "" }] };
    expect(leerConceptosSnapshot(nuevo)!.faltas).toHaveLength(1);
  });

  it("el detalle de planilla y la boleta muestran las faltas (API de planilla + boleta del colaborador)", () => {
    expect(readFileSync("src/app/api/empresas/[slug]/rrhh/planillas/[id]/route.ts", "utf8").match(/conceptosSnapshot\.faltas/g)).toHaveLength(2);
    const boleta = readFileSync("src/app/portal/boletas/[id]/page.tsx", "utf8");
    expect(boleta).toContain("listarFaltasAplicadasDetalle");
    expect(boleta).toContain("...faltasDetalle");
  });

  it("ISR 2026 e IGSS: el motor fiscal solo lee horas extra y prestaciones; las faltas no entran a su base", () => {
    const fiscal = readFileSync("src/lib/rrhh/planilla-fiscal-2026.ts", "utf8");
    expect(fiscal).not.toMatch(/pendientes\.faltas|\.descuentosLegado|pendientes\.cuotas|pendientes\.manuales/);
    expect(readFileSync("src/lib/rrhh/planillas.ts", "utf8")).toMatch(/igssMensual = out \? 0 : redondearQ\(sueldo \* IGSS_LABORAL_PCT\)/);
  });
});
