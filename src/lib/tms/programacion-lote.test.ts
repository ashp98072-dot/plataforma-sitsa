import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn(async () => []) }));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn() }));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(async () => 1), guardarAuxiliaresPlan: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ guardarParadasPlan: vi.fn(), listarParadasDePlanes: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ sincronizarViaticosPlan: vi.fn() }));
vi.mock("@/lib/tms/ruta-tarifas", () => ({ tarifasActivasDeVariasRutas: vi.fn() }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { personalDesdeEmpleado } from "@/lib/tms/personal-resolucion";
import { guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import { guardarParadasPlan, listarParadasDePlanes } from "@/lib/tms/paradas";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { tarifasActivasDeVariasRutas } from "@/lib/tms/ruta-tarifas";
import { asegurarCodigoPlanUnico } from "@/lib/tms/codigo-plan";
import { ESTADOS_ASIGNACION_DIARIA } from "@/lib/tms/disponibilidad-programacion-dia";
import { confirmarLote, MAX_FILAS_LOTE, validarLote, type BorradorLote } from "./programacion-lote";
import { borradoresDesdeCliente, cargarCopiaDeFecha } from "./programacion-copia";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — motor de lote + copiar programación. Base EN MEMORIA que responde a las consultas
 * reales del motor y de la política de disponibilidad diaria (que corre REAL: personal/unidad/TC), con transacciones
 * que respaldan y restauran el estado (rollback verificable). No hay base de datos real.
 */
const EMP = 7;
const ORIGEN = "2026-09-24";
const DESTINO = "2026-09-25";

type Plan = {
  id: number; empresa_id: number; codigo: string; estado: string; fecha: string; cliente_id: number | null; unidad_id: number | null; piloto_id: number | null;
  auxiliar_id: number | null; aux: number[]; tc_vehiculo_id: number | null; tipo_viaje: string; ruta_id: number | null;
  hora: string | null; regreso?: string | null; tarifa_comercial: number | null; tarifa_id: number | null; tarifa_nombre: string | null; tc_placa: string | null;
  tc_externo: string | null; piloto_externo: string | null; unidad_ext: string | null; cerrado_por?: string | null;
};
type Estado = {
  planes: Plan[]; origen: { plan_id: number; tipo: string; plan_origen_id: number | null; fecha_destino: string; creado_por: string }[];
  auxiliares: { plan_id: number; personal_id: number }[]; paradas: { plan_id: number; lugar: string }[]; viaticos: { plan_id: number }[];
  auditorias: { accion: string; detalle: string }[]; personal: { id: number; id_empleado: number; nombre: string }[]; unidades: { id: number; placa: string }[];
  sigPlan: number; sigPersonal: number; sigCodigo: number;
};
let e: Estado;
let respaldo: string;
let falla: { en: "origen" | "viaticos" | "auditoria" | "paradas" | "auxiliares" | null; enPlanNumero: number };
let sinTablaOrigen = false;
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };

const flota: Record<number, { id: number; placa: string; activo: number; en_taller: number; tipo_unidad: string; empresa_id: number }> = {
  31: { id: 31, placa: "TC-1", activo: 1, en_taller: 0, tipo_unidad: "TC", empresa_id: 7 },
  32: { id: 32, placa: "TC-2", activo: 1, en_taller: 0, tipo_unidad: "TC", empresa_id: 7 },
};
const empleados: Record<number, { id: number; nombre: string; estado: string }> = {
  1: { id: 1, nombre: "Juan Pérez", estado: "Activo" }, 2: { id: 2, nombre: "Ana López", estado: "Activo" }, 3: { id: 3, nombre: "Beto Ruiz", estado: "Activo" },
  4: { id: 4, nombre: "Carla Díaz", estado: "Activo" }, 5: { id: 5, nombre: "Inactivo Uno", estado: "Baja" },
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [20 + i, { id: 20 + i, nombre: `Aux ${i}`, estado: "Activo" }])),
};
const rutas: Record<number, Record<string, unknown>> = {
  10: { id: 10, codigo: "1001", cliente_id: 3, activo: 1, lugar_carga_texto: "Bodega", destino_descripcion: "Xela", contacto_nombre: "Contacto A", contacto_cargo: "Jefe", contacto_telefono: "5555" },
  11: { id: 11, codigo: "1002", cliente_id: 3, activo: 1, lugar_carga_texto: "Bodega", destino_descripcion: "Antigua", contacto_nombre: null, contacto_cargo: null, contacto_telefono: null },
  12: { id: 12, codigo: "1003", cliente_id: 3, activo: 1, lugar_carga_texto: null, destino_descripcion: null, contacto_nombre: null, contacto_cargo: null, contacto_telefono: null }, // sin tarifa
  13: { id: 13, codigo: "1004", cliente_id: 3, activo: 0, lugar_carga_texto: null, destino_descripcion: null, contacto_nombre: null, contacto_cargo: null, contacto_telefono: null }, // inactiva
};
const tarifas = new Map([
  [10, { tarifas: [{ id: 100, nombre: "Base", monto: 1500, moneda: "GTQ", predeterminada: true }, { id: 101, nombre: "Refrigerado", monto: 1800, moneda: "GTQ", predeterminada: false }], predeterminadaId: 100 }],
  [11, { tarifas: [{ id: 110, nombre: "Única", monto: 900, moneda: "GTQ", predeterminada: true }], predeterminadaId: 110 }],
]);
const vehiculo = (id: number, placa: string, tipoUnidad: string, extra: Record<string, unknown> = {}) => ({ id, placa, tipoUnidad, activo: true, puedeEnviar: true, motivoNoDisponible: null, estadoDisponibilidad: "disponible", esPropio: true, marca: null, modelo: null, ...extra });

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 0, empresa_id: EMP, codigo: "X", estado: "Programado", fecha: DESTINO, cliente_id: 3, unidad_id: null, piloto_id: null, auxiliar_id: null, aux: [], tc_vehiculo_id: null,
  tipo_viaje: "Propio", ruta_id: 10, hora: "03:00", tarifa_comercial: null, tarifa_id: null, tarifa_nombre: null, tc_placa: null, tc_externo: null, piloto_externo: null, unidad_ext: null, ...over,
});
const borrador = (over: Partial<BorradorLote> = {}): BorradorLote => ({
  fila: 1, origenPlanId: 900, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: "Carga", tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: null,
  pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], tarifaId: null, externo: null, paradas: [], ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  sinTablaOrigen = false;
  falla = { en: null, enPlanNumero: 0 };
  e = {
    planes: [], origen: [], auxiliares: [], paradas: [], viaticos: [], auditorias: [],
    personal: [{ id: 501, id_empleado: 1, nombre: "Juan Pérez" }, { id: 502, id_empleado: 2, nombre: "Ana López" }],
    unidades: [{ id: 601, placa: "P-1" }, { id: 602, placa: "P-2" }], sigPlan: 1000, sigPersonal: 700, sigCodigo: 1,
  };
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [vehiculo(1, "P-1", "VEHICULO"), vehiculo(2, "P-2", "VEHICULO"), vehiculo(3, "P-3", "VEHICULO", { puedeEnviar: false, motivoNoDisponible: "En taller" }), vehiculo(31, "TC-1", "TC"), vehiculo(32, "TC-2", "TC")] } as never);
  vi.mocked(listarDisponibilidadPersonal).mockResolvedValue([]);
  vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (empresa: number, id: number) => (flota[id] && flota[id].empresa_id === empresa ? flota[id] : null)) as never);
  vi.mocked(tarifasActivasDeVariasRutas).mockImplementation((async (_e: number, ids: number[]) => new Map([...tarifas].filter(([id]) => ids.includes(id)))) as never);
  vi.mocked(asegurarCodigoPlanUnico).mockImplementation((async () => `PLAN-NUEVO-${String(e.sigCodigo++).padStart(3, "0")}`) as never);
  vi.mocked(personalDesdeEmpleado).mockImplementation((async (_e: number, empleadoId: number) => {
    const ya = e.personal.find((p) => p.id_empleado === empleadoId);
    if (ya) return ya.id;
    const p = { id: e.sigPersonal++, id_empleado: empleadoId, nombre: empleados[empleadoId]?.nombre ?? "?" };
    e.personal.push(p);
    return p.id;
  }) as never);
  vi.mocked(guardarAuxiliaresPlan).mockImplementation((async (planId: number, ids: number[]) => {
    if (falla.en === "auxiliares" && e.planes.filter((p) => p.fecha === DESTINO).length >= falla.enPlanNumero) throw new Error("fallo auxiliares");
    for (const id of ids) e.auxiliares.push({ plan_id: planId, personal_id: id });
  }) as never);
  vi.mocked(guardarParadasPlan).mockImplementation((async (_e: number, planId: number, p: { lugarNombre: string }[]) => {
    if (falla.en === "paradas" && e.planes.filter((x) => x.fecha === DESTINO).length >= falla.enPlanNumero) throw new Error("fallo paradas");
    for (const x of p) e.paradas.push({ plan_id: planId, lugar: x.lugarNombre });
    return { ok: true };
  }) as never);
  vi.mocked(sincronizarViaticosPlan).mockImplementation((async (_e: number, planId: number) => {
    if (falla.en === "viaticos" && e.planes.filter((x) => x.fecha === DESTINO).length >= falla.enPlanNumero) throw new Error("fallo viáticos");
    e.viaticos.push({ plan_id: planId });
  }) as never);
  vi.mocked(registrarAuditoriaTx).mockImplementation((async (_c: unknown, a: { accion: string; detalle?: string }) => {
    if (falla.en === "auditoria") throw new Error("auditoría falló");
    e.auditorias.push({ accion: a.accion, detalle: a.detalle ?? "" });
  }) as never);
  vi.mocked(listarParadasDePlanes).mockImplementation((async (ids: number[]) => new Map(ids.map((id) => [id, [{ lugar_nombre: "Bodega", tipo: "Carga", requiere_evidencia: true }, { lugar_nombre: "Xela", tipo: "Descarga", requiere_evidencia: true }]]))) as never);

  // ---- consultas ----
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql);
    if (s.includes("SELECT 1 FROM tms_plan_origen")) { if (sinTablaOrigen) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }); return []; }
    if (s.includes("FROM tms_plan_origen o")) {
      if (sinTablaOrigen) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
      const [emp, fecha, ...ids] = params as [number, string, ...number[]];
      return e.origen.filter((o) => o.tipo === "COPIA" && o.fecha_destino === fecha && ids.includes(o.plan_origen_id as number))
        .map((o) => ({ o, p: e.planes.find((p) => p.id === o.plan_id)! })).filter(({ p }) => p.empresa_id === emp && p.estado !== "Cancelado")
        .map(({ o, p }) => ({ plan_origen_id: o.plan_origen_id, codigo: p.codigo }));
    }
    if (s.includes("FROM tms_cliente_rutas r")) { const [emp, ...ids] = params as number[]; return emp === EMP ? ids.map((i) => rutas[i]).filter(Boolean) : []; }
    if (s.includes("FROM tms_clientes WHERE")) return [{ id: 3 }];
    if (s.includes("FROM empleados WHERE empresa_id = ? AND id IN")) { const [emp, ...ids] = params as number[]; return emp === EMP ? ids.map((i) => empleados[i]).filter(Boolean) : []; }
    if (s.includes("FROM tms_personal WHERE empresa_id = ? AND id_empleado IN")) { const [, ...ids] = params as number[]; return e.personal.filter((p) => ids.includes(p.id_empleado)).map((p) => ({ id: p.id, tipo: "Piloto", id_empleado: p.id_empleado })); }
    if (s.includes("SELECT id, placa FROM tms_unidades")) return e.unidades;
    // A2.2 — política de disponibilidad por INTERVALOS (REAL): personal / unidad / TC. Emula el predicado de ventana
    // (fecha_plan <= fin, y fecha_plan >= inicio o regreso > inicio); la decisión de solape es del código de producción.
    const n = ESTADOS_ASIGNACION_DIARIA.length;
    const emp = Number(params[0]);
    const fechaFin = String(params[1 + n]);
    const fechaInicio = String(params[2 + n]);
    const inicioVentana = String(params[3 + n]);
    const nEx = (/p\.id NOT IN \(([?,]+)\)/.exec(s)?.[1].split(",").length) ?? 0;
    const excl = (nEx ? params.slice(-nEx) : []) as number[];
    const ids = params.slice(s.includes("FROM tms_personal tp") ? 5 + n : 4 + n, params.length - nEx).filter((x): x is number => typeof x === "number");
    const ocupa = (p: Plan) => p.empresa_id === emp && (ESTADOS_ASIGNACION_DIARIA as readonly string[]).includes(p.estado) && !excl.includes(p.id)
      && p.fecha <= fechaFin && (p.fecha >= fechaInicio || (p.regreso != null && p.regreso > inicioVentana));
    const fila = (p: Plan, recurso_id: unknown, nombre: unknown) => ({ recurso_id, nombre, plan_id: p.id, codigo: p.codigo, fecha_plan: p.fecha, hora_carga: p.hora, regreso_estimado: p.regreso ?? null });
    if (s.includes("FROM tms_personal tp")) {
      return e.personal.filter((tp) => ids.includes(tp.id)).flatMap((tp) => {
        const eq = new Set(e.personal.filter((x) => x.id === tp.id || x.id_empleado === tp.id_empleado).map((x) => x.id));
        return e.planes.filter((p) => ocupa(p) && ((p.piloto_id != null && eq.has(p.piloto_id)) || p.aux.some((a) => eq.has(a)))).map((p) => fila(p, tp.id, tp.nombre));
      });
    }
    if (s.includes("FROM tms_unidades u")) return e.planes.filter((p) => ocupa(p) && p.unidad_id != null && ids.includes(p.unidad_id)).map((p) => fila(p, p.unidad_id, e.unidades.find((u) => u.id === p.unidad_id)?.placa));
    if (s.includes("p.tc_vehiculo_id = v.id")) return e.planes.filter((p) => ocupa(p) && p.tc_vehiculo_id != null && ids.includes(p.tc_vehiculo_id)).map((p) => fila(p, p.tc_vehiculo_id, flota[p.tc_vehiculo_id as number]?.placa));
    return [];
  }) as never);

  // ---- transacción con respaldo/restauración ----
  conn.beginTransaction.mockImplementation(async () => { respaldo = JSON.stringify(e); });
  conn.rollback.mockImplementation(async () => { e = JSON.parse(respaldo); });
  conn.query.mockImplementation(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]]));
  conn.execute.mockImplementation(async (sql: string, p: unknown[]) => {
    const s = String(sql);
    if (s.includes("INSERT INTO tms_unidades")) {
      const placa = p[1] as string;
      let u = e.unidades.find((x) => x.placa === placa);
      if (!u) { u = { id: 800 + e.unidades.length, placa }; e.unidades.push(u); }
      return [{ insertId: u.id }];
    }
    if (s.includes("INSERT INTO tms_planes_viaje")) {
      const id = e.sigPlan++;
      e.planes.push(plan({ id, codigo: p[1] as string, cliente_id: p[2] as number | null, unidad_id: p[5] as number | null, piloto_id: p[6] as number | null, auxiliar_id: p[7] as number | null,
        fecha: p[8] as string, hora: p[9] as string | null, regreso: p[11] as string | null, tarifa_comercial: p[12] as number | null, tarifa_id: p[13] as number | null, tarifa_nombre: p[14] as string | null, ruta_id: p[17] as number | null,
        tipo_viaje: p[23] as string, piloto_externo: p[24] as string | null, unidad_ext: p[26] as string | null, tc_vehiculo_id: p[30] as number | null, tc_placa: p[31] as string | null, tc_externo: p[32] as string | null,
        aux: [] }));
      return [{ insertId: id }];
    }
    if (s.includes("INSERT INTO tms_plan_origen")) {
      if (falla.en === "origen" && e.origen.length + 1 >= falla.enPlanNumero) throw new Error("fallo origen");
      e.origen.push({ plan_id: p[1] as number, tipo: p[2] as string, plan_origen_id: p[3] as number | null, fecha_destino: p[4] as string, creado_por: p[5] as string });
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 1 }];
  });
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  // guardarAuxiliaresPlan real del motor solo necesita reflejar ids en el plan (para disponibilidad posterior)
  vi.mocked(guardarAuxiliaresPlan).mockImplementation((async (planId: number, ids: number[]) => {
    if (falla.en === "auxiliares" && e.planes.filter((x) => x.fecha === DESTINO).length >= falla.enPlanNumero) throw new Error("fallo auxiliares");
    const pl = e.planes.find((x) => x.id === planId); if (pl) pl.aux = ids;
    for (const id of ids) e.auxiliares.push({ plan_id: planId, personal_id: id });
  }) as never);
});

const creadosDestino = () => e.planes.filter((p) => p.fecha === DESTINO && p.id >= 1000); // los ids < 1000 son viajes preexistentes del escenario
const confirmar = (b: BorradorLote[], fecha = DESTINO) => confirmarLote(EMP, "jefe", fecha, { tipo: "COPIA", fechaOrigen: ORIGEN }, b);

describe("motor: creación por lote (feliz)", () => {
  it("crea varios viajes Propio con unidad, TC, piloto y 0..8 auxiliares; todos nacen Programado con paradas, viáticos y origen", async () => {
    const lote = [
      borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "P-1", tcVehiculoId: 31, pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [] }),
      borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", tcVehiculoId: 32, pilotoEmpleadoId: 3, auxiliarEmpleadoIds: [20, 21, 22, 23, 24, 25, 26, 27], rutaId: 11 }),
      borrador({ fila: 3, origenPlanId: 902, unidadPlaca: null, pilotoEmpleadoId: 4, auxiliarEmpleadoIds: [28] }),
    ];
    const r = await confirmar(lote);
    expect(r).toMatchObject({ ok: true, codigos: ["PLAN-NUEVO-001", "PLAN-NUEVO-002", "PLAN-NUEVO-003"] });
    const [a, b, c] = creadosDestino();
    expect(creadosDestino().every((p) => p.estado === "Programado" && p.cerrado_por == null)).toBe(true);
    expect([a.tc_vehiculo_id, a.tc_placa]).toEqual([31, "TC-1"]);
    expect(b.aux).toHaveLength(8);
    expect(c.unidad_id).toBeNull();
    expect(e.viaticos).toHaveLength(3); // sincronizarViaticosPlan por cada plan (configuración vigente)
    expect(e.paradas).toHaveLength(6); // paradas del origen (2 por plan)
    expect(e.origen).toEqual([
      expect.objectContaining({ tipo: "COPIA", plan_origen_id: 900, fecha_destino: DESTINO, creado_por: "jefe" }),
      expect.objectContaining({ plan_origen_id: 901 }), expect.objectContaining({ plan_origen_id: 902 }),
    ]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("dos viajes DIFERENTES de la misma ruta el mismo día son válidos (identidad = plan origen, no la ruta)", async () => {
    const r = await confirmar([borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "P-1", pilotoEmpleadoId: 1 }), borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3 })]);
    expect(r.ok).toBe(true);
    expect(creadosDestino().filter((p) => p.ruta_id === 10)).toHaveLength(2);
  });

  it("límites: máximo 8 auxiliares y máximo de filas por lote", async () => {
    const nueve = await validarLote(EMP, DESTINO, [borrador({ auxiliarEmpleadoIds: [20, 21, 22, 23, 24, 25, 26, 27, 28] })]);
    expect(nueve[0].errores.join(" ")).toContain("Máximo 8 auxiliares");
    expect(await confirmar(Array.from({ length: MAX_FILAS_LOTE + 1 }, (_, i) => borrador({ fila: i + 1 })))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("tarifa: siempre re-resuelta; solo tarifas vigentes del catálogo", () => {
  it("toma la tarifa vigente/predeterminada de la ruta y crea snapshots NUEVOS (no la del origen)", async () => {
    const r = await confirmar([borrador()]);
    expect(r.ok).toBe(true);
    expect(creadosDestino()[0]).toMatchObject({ tarifa_comercial: 1500, tarifa_id: 100, tarifa_nombre: "Base" });
  });
  it("puede elegir OTRA tarifa vigente de la ruta", async () => {
    await confirmar([borrador({ tarifaId: 101 })]);
    expect(creadosDestino()[0]).toMatchObject({ tarifa_comercial: 1800, tarifa_id: 101, tarifa_nombre: "Refrigerado" });
  });
  it("una tarifa que no es vigente de ESA ruta (o de otra ruta) se rechaza: no hay monto libre", async () => {
    const r = await validarLote(EMP, DESTINO, [borrador({ tarifaId: 110 }), borrador({ fila: 2, origenPlanId: 901, tarifaId: 99999 })]);
    expect(r.map((x) => x.estado)).toEqual(["error", "error"]);
    expect(r[0].errores[0]).toContain("no es una tarifa vigente de esta ruta");
    expect(readFileSync("src/lib/tms/programacion-copia-schema.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/tarifaComercial|monto/i); // el esquema no admite montos
  });
  it("ruta sin tarifa vigente -> la fila tiene error; ruta inactiva/inexistente -> error", async () => {
    const r = await validarLote(EMP, DESTINO, [borrador({ rutaId: 12 }), borrador({ fila: 2, origenPlanId: 901, rutaId: 13 }), borrador({ fila: 3, origenPlanId: 902, rutaId: 99 })]);
    expect(r[0].errores[0]).toContain("no tiene una tarifa vigente");
    expect(r[1].errores[0]).toContain("inactiva");
    expect(r[2].errores[0]).toContain("no existe");
  });
  it("el origen NUNCA aporta la tarifa: la carga del cliente deja tarifaId en null", async () => {
    const src = readFileSync("src/lib/tms/programacion-copia.ts", "utf8");
    expect(src).toContain("tarifaId: null");
    expect(src).not.toMatch(/tarifa_comercial|tarifa_monto|tarifa_nombre/);
  });
});

describe("disponibilidad (política diaria REAL) y colisiones dentro del lote", () => {
  const ocupar = (over: Partial<Plan>) => e.planes.push(plan({ id: 50, codigo: "PLAN-EXISTENTE", ...over }));
  it("piloto ocupado el mismo día por un viaje existente", async () => {
    ocupar({ piloto_id: 501 });
    const r = await validarLote(EMP, DESTINO, [borrador({ pilotoEmpleadoId: 1 })]);
    expect(r[0].errores).toEqual(["El piloto Juan Pérez ya está asignado al PLAN-EXISTENTE para el 25/09/2026."]);
  });
  it("auxiliar ocupado", async () => {
    ocupar({ aux: [502] });
    const r = await validarLote(EMP, DESTINO, [borrador({ auxiliarEmpleadoIds: [2] })]);
    expect(r[0].errores[0]).toContain("Ana López ya está asignado");
  });
  it("unidad ocupada", async () => {
    ocupar({ unidad_id: 601 });
    expect((await validarLote(EMP, DESTINO, [borrador()]))[0].errores[0]).toBe("La unidad P-1 ya está asignada al PLAN-EXISTENTE para el 25/09/2026.");
  });
  it("TC ocupado", async () => {
    ocupar({ tc_vehiculo_id: 31 });
    expect((await validarLote(EMP, DESTINO, [borrador({ tcVehiculoId: 31 })]))[0].errores[0]).toBe("El TC TC-1 ya está asignado al PLAN-EXISTENTE para el 25/09/2026.");
  });
  it("un viaje Cancelado o de otra fecha/empresa NO ocupa el recurso", async () => {
    ocupar({ piloto_id: 501, estado: "Cancelado" });
    ocupar({ id: 51, piloto_id: 501, fecha: "2026-09-26" });
    ocupar({ id: 52, piloto_id: 501, empresa_id: 8 });
    expect((await validarLote(EMP, DESTINO, [borrador()]))[0].estado).toBe("ok");
  });
  it("conflicto ENTRE dos filas del lote (piloto, unidad y TC repetidos): error en ambas con la fila del otro", async () => {
    const r = await validarLote(EMP, DESTINO, [
      borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "P-1", tcVehiculoId: 31, pilotoEmpleadoId: 1 }),
      borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-1", tcVehiculoId: 31, pilotoEmpleadoId: 1 }),
    ]);
    expect(r.map((x) => x.estado)).toEqual(["error", "error"]);
    const txt = r[0].errores.join(" | ");
    expect(txt).toContain("Juan Pérez está asignado también en la fila 2");
    expect(txt).toContain("La unidad P-1 está asignada también en la fila 2");
    expect(txt).toContain("El TC #31 está asignado también en la fila 2");
    expect(r[1].errores.join(" ")).toContain("fila 1");
  });
  it("cambio DESPUÉS de la preview: la preview era ok pero al confirmar otro viaje tomó el recurso => nada se crea", async () => {
    expect((await validarLote(EMP, DESTINO, [borrador()]))[0].estado).toBe("ok");
    ocupar({ piloto_id: 501 }); // otro usuario programó al piloto entre tanto
    const r = await confirmar([borrador()]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.erroresPorFila?.[0].errores[0]).toContain("PLAN-EXISTENTE");
    expect(creadosDestino()).toHaveLength(0);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it("hoy: un piloto con viaje en curso se rechaza (mismo control del POST manual)", async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    vi.mocked(listarDisponibilidadPersonal).mockResolvedValue([{ personalId: 501, nombre: "Juan Pérez", viajeActual: { id: 1 } }] as never);
    const r = await validarLote(EMP, hoy, [borrador()]);
    expect(r[0].errores.join(" ")).toContain("viaje en curso");
  });
  it("recursos inválidos: unidad inexistente / no disponible / es TC; TC que no es TC; piloto inactivo; misma persona dos veces", async () => {
    const r = await validarLote(EMP, DESTINO, [
      borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "NO-EXISTE" }),
      borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-3", pilotoEmpleadoId: 2 }),
      borrador({ fila: 3, origenPlanId: 902, unidadPlaca: "TC-1", pilotoEmpleadoId: 3 }),
      borrador({ fila: 4, origenPlanId: 903, unidadPlaca: null, tcVehiculoId: 999, pilotoEmpleadoId: 4 }),
      borrador({ fila: 5, origenPlanId: 904, unidadPlaca: null, pilotoEmpleadoId: 5 }),
      borrador({ fila: 6, origenPlanId: 905, unidadPlaca: null, pilotoEmpleadoId: 20, auxiliarEmpleadoIds: [20] }),
    ]);
    expect(r[0].errores[0]).toContain("no existe en el sistema");
    expect(r[1].errores[0]).toContain("no está disponible: En taller");
    expect(r[2].errores[0]).toContain("clasificada como TC");
    expect(r[3].errores[0]).toContain("no existe o no es accesible");
    expect(r[4].errores[0]).toContain("inactivo");
    expect(r[5].errores[0]).toContain("no pueden repetirse");
  });
});

describe("tercerizados: solo texto externo, sin recursos ni disponibilidad internos", () => {
  const externo = { pilotoExternoNombre: "Piloto Ext", auxiliaresExternos: ["Aux Ext"], unidadExternaPlaca: "x-123", unidadExternaDescripcion: "Camión", transportistaExterno: "Transp", costoTercerizado: 500, tcExternoPlaca: "tx-9" };
  const terc = (over: Partial<BorradorLote> = {}) => borrador({ tipoViaje: "Tercerizado", unidadPlaca: null, pilotoEmpleadoId: null, tcVehiculoId: null, auxiliarEmpleadoIds: [], externo, ...over });

  it("se crea con los campos externos (TC externo incluido) y NO crea personal/unidad/TC internos ni viáticos con personal", async () => {
    e.planes.push(plan({ id: 60, codigo: "OTRO", piloto_id: 501, unidad_id: 601, tc_vehiculo_id: 31 })); // los mismos recursos internos ocupados: no aplica a un tercerizado
    const r = await confirmar([terc()]);
    expect(r.ok).toBe(true);
    const p = creadosDestino().find((x) => x.tipo_viaje === "Tercerizado")!;
    expect(p).toMatchObject({ piloto_externo: "Piloto Ext", unidad_ext: "X-123", tc_externo: "TX-9", piloto_id: null, unidad_id: null, tc_vehiculo_id: null, tc_placa: null });
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toEqual({ piloto: null, auxiliares: [] });
    expect(conn.execute.mock.calls.some(([s]) => String(s).includes("INSERT INTO tms_unidades"))).toBe(false);
  });
  it("valida: piloto externo obligatorio, límites de longitud (placa 40) y no mezcla recursos internos", async () => {
    const r = await validarLote(EMP, DESTINO, [
      terc({ fila: 1, origenPlanId: 900, externo: { ...externo, pilotoExternoNombre: " " } }),
      terc({ fila: 2, origenPlanId: 901, externo: { ...externo, tcExternoPlaca: "T".repeat(41) } }),
      terc({ fila: 3, origenPlanId: 902, tcVehiculoId: 31, pilotoEmpleadoId: 1 }),
      borrador({ fila: 4, origenPlanId: 903, externo }),
    ]);
    expect(r[0].errores[0]).toContain("piloto externo");
    expect(r[1].errores[0]).toContain("40");
    expect(r[2].errores[0]).toContain("no usa recursos internos");
    expect(r[3].errores[0]).toContain("propio no lleva datos de tercerizado");
  });
});

describe("todo o nada: rollback COMPLETO", () => {
  const lote3 = () => [borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "P-1", pilotoEmpleadoId: 1 }), borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3, auxiliarEmpleadoIds: [20] }), borrador({ fila: 3, origenPlanId: 902, unidadPlaca: null, pilotoEmpleadoId: 4 })];
  it.each([["origen"], ["viaticos"], ["paradas"], ["auxiliares"]] as const)("si falla %s en la fila 2: 0 planes y ninguna escritura queda (auxiliares, paradas, viáticos, origen, personal, unidades, auditoría)", async (paso) => {
    falla = { en: paso, enPlanNumero: 2 };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const antes = JSON.stringify({ personal: e.personal, unidades: e.unidades });
    const r = await confirmar(lote3());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(creadosDestino()).toEqual([]);
    expect(e.origen).toEqual([]);
    expect(e.auxiliares).toEqual([]);
    expect(e.paradas).toEqual([]);
    expect(e.viaticos).toEqual([]);
    expect(e.auditorias).toEqual([]);
    expect(JSON.stringify({ personal: e.personal, unidades: e.unidades })).toBe(antes); // ni personal ni unidades materializados
  });
  it("si falla la AUDITORÍA del lote: también rollback de todo", async () => {
    falla = { en: "auditoria", enPlanNumero: 0 };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await confirmar(lote3());
    expect(r.ok).toBe(false);
    expect(creadosDestino()).toEqual([]);
    expect(e.origen).toEqual([]);
  });
  it("una fila inválida (revalidación final) => 0 planes, errores por fila, sin abrir transacción", async () => {
    const r = await confirmar([...lote3().slice(0, 2), borrador({ fila: 3, origenPlanId: 902, unidadPlaca: "NO-EXISTE", pilotoEmpleadoId: 4 })]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.erroresPorFila).toEqual([{ fila: 3, errores: expect.any(Array) }]);
    expect(creadosDestino()).toEqual([]);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it("el candado por empresa se toma y se libera SIEMPRE (éxito, validación fallida y error)", async () => {
    await confirmar(lote3());
    const sqls = conn.query.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => s.includes("GET_LOCK"))).toBe(true);
    expect(sqls.some((s) => s.includes("RELEASE_LOCK"))).toBe(true);
    expect(conn.query.mock.calls.find(([s]) => String(s).includes("GET_LOCK"))![1]).toEqual([`tms_traslape_${EMP}`, 8]);
  });
  it("si el candado no se obtiene (otra operación en curso): 409 y no se crea ni se libera", async () => {
    conn.query.mockImplementation(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 0 }]] : [[]]));
    const r = await confirmar(lote3());
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(conn.query.mock.calls.some(([s]) => String(s).includes("RELEASE_LOCK"))).toBe(false);
    expect(creadosDestino()).toEqual([]);
  });
  it("sin la migración de tms_plan_origen: 409 y no se crea nada", async () => {
    sinTablaOrigen = true;
    const r = await confirmar(lote3());
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toContain("migración");
    expect(creadosDestino()).toEqual([]);
    expect(getPool).not.toHaveBeenCalled();
  });
});

describe("anti-duplicado (origen + fecha destino) y trazabilidad", () => {
  it("doble confirmación: la segunda se bloquea con 'Este viaje ya fue copiado para esta fecha' y no duplica", async () => {
    expect((await confirmar([borrador()])).ok).toBe(true);
    const r = await confirmar([borrador()]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.erroresPorFila?.[0].errores[0]).toContain("Este viaje ya fue copiado para esta fecha");
    expect(creadosDestino()).toHaveLength(1);
    expect(e.origen).toHaveLength(1);
  });
  it("si el plan copiado anterior fue CANCELADO, se permite volver a copiar y se conserva el registro anterior", async () => {
    await confirmar([borrador()]);
    creadosDestino()[0].estado = "Cancelado";
    const r = await confirmar([borrador()]);
    expect(r.ok).toBe(true);
    expect(e.origen).toHaveLength(2); // trazabilidad del intento anterior intacta
    expect(e.origen.every((o) => o.plan_origen_id === 900)).toBe(true);
  });
  it("otra fecha destino o otro plan origen de la misma ruta NO están bloqueados", async () => {
    await confirmar([borrador()]);
    expect((await confirmar([borrador({ origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3 })])).ok).toBe(true);
    expect((await confirmar([borrador()], "2026-09-26")).ok).toBe(true);
  });
  it("el SQL del anti-duplicado usa el índice (empresa, tipo, fecha_destino, plan_origen_id) y solo cuenta planes NO cancelados; la migración NO tiene UNIQUE por origen+fecha", () => {
    const lib = readFileSync("src/lib/tms/programacion-lote.ts", "utf8");
    expect(lib).toContain("o.empresa_id = ? AND o.tipo = 'COPIA' AND o.fecha_destino = ?");
    expect(lib).toContain("p.estado <> 'Cancelado'");
    const sql = readFileSync("sql/migrate-2026-09-tms-plan-origen.sql", "utf8");
    expect(sql).toContain("INDEX idx_plan_origen_dup (empresa_id, tipo, fecha_destino, plan_origen_id)");
    expect(sql).not.toMatch(/UNIQUE KEY[^\n]*(plan_origen_id|fecha_destino)/);
    expect(sql).toContain("ON DELETE SET NULL");
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/ALTER TABLE|DROP |TRUNCATE|DELETE FROM/i);
  });
  it("auditoría: UNA entrada resumen del lote (fechas y cantidad); los planes no duplican eventos", async () => {
    await confirmar([borrador({ fila: 1, origenPlanId: 900 }), borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3 })]);
    expect(e.auditorias).toHaveLength(1);
    expect(e.auditorias[0]).toMatchObject({ accion: "copiar_programacion" });
    expect(e.auditorias[0].detalle).toContain("Copió programación 24/09/2026 → 25/09/2026. 2 plan(es) creados");
  });
});

// ------------------------------------------------------------------ copiar: origen -> borradores
describe("copiar programación de otra fecha", () => {
  const origenRow = (over: Record<string, unknown> = {}) => ({
    id: 900, codigo: "PLAN-20260924-001", estado: "Cerrado", cliente_id: 3, cliente_nombre: "Acme", ruta_id: 10, ruta_codigo_historico: "1001", hora_carga: "03:00:00", regreso_estimado: null, tipo_traslado: "Carga",
    tipo_viaje: "Propio", unidad_placa: "P-1", tc_vehiculo_id: 31, tc_placa_historica: "TC-1", tc_externo_placa: null, piloto_empleado_id: 1, piloto_nombre: "Juan Pérez",
    aux1_empleado_id: null, aux1_nombre: null, piloto_externo_nombre: null, auxiliares_externos: null, unidad_externa_placa: null, unidad_externa_descripcion: null,
    transportista_externo: null, costo_tercerizado: null,
    // datos de HISTORIA que NO deben copiarse (el SELECT ni siquiera los pide)
    cerrado_por: "jefe", cerrado_en: "2026-09-24 20:00:00", tarifa_comercial: 999, tarifa_nombre_historico: "VIEJA", km_llegada: 350, ...over,
  });
  const cargar = (rows: Record<string, unknown>[], aux: Record<string, unknown>[] = []) => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      const s = String(sql);
      if (s.includes("LEFT JOIN tms_clientes c") && s.includes("p.fecha_plan = ?")) { expect(s).toContain("p.estado <> 'Cancelado'"); return rows; }
      if (s.includes("FROM tms_plan_auxiliares pa")) return aux;
      return base(sql, params);
    }) as never);
    return cargarCopiaDeFecha(EMP, ORIGEN);
  };

  it("un Cerrado sirve de origen (se copia su configuración, no su estado) y el SQL de origen EXCLUYE Cancelados", async () => {
    const filas = await cargar([origenRow({ estado: "Cerrado" }), origenRow({ id: 901, estado: "Programado", codigo: "P2" })]);
    expect(filas.map((f) => f.origen.estado)).toEqual(["Cerrado", "Programado"]);
  });

  it("copia solo configuración: cliente, ruta, hora, traslado, tipo, unidad, TC, piloto, auxiliares (0..8) y paradas; tarifa NULL", async () => {
    const aux = Array.from({ length: 8 }, (_, i) => ({ plan_id: 900, orden: i + 1, id_empleado: 20 + i, nombre: `Aux ${i}` }));
    const [f] = await cargar([origenRow()], aux);
    expect(f.borrador).toEqual({
      fila: 1, origenPlanId: 900, rutaId: 10, clienteId: 3, horaCarga: "03:00", regresoOffsetDias: null, regresoHora: null, tipoTraslado: "Carga", tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: 31,
      pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [20, 21, 22, 23, 24, 25, 26, 27], tarifaId: null, externo: null,
      paradas: [{ lugarNombre: "Bodega", tipo: "Carga", requiereEvidencia: true }, { lugarNombre: "Xela", tipo: "Descarga", requiereEvidencia: true }],
    });
    // Nada de historia en el borrador (ni siquiera como campos ocultos)
    expect(JSON.stringify(f.borrador)).not.toMatch(/cerrado|km|VIEJA|999|estado|factura|evidencias|bitacora|gasto/i);
  });

  it("TERCERIZADO: copia solo los campos externos (incl. TC externo); sin unidad/piloto/TC internos", async () => {
    const [f] = await cargar([origenRow({ tipo_viaje: "Tercerizado", unidad_placa: null, tc_vehiculo_id: null, tc_placa_historica: null, tc_externo_placa: "TX-9", piloto_empleado_id: null, piloto_nombre: null,
      piloto_externo_nombre: "Piloto Ext", auxiliares_externos: "A1\nA2", unidad_externa_placa: "X-1", unidad_externa_descripcion: "Camión", transportista_externo: "Transp", costo_tercerizado: 500 })]);
    expect(f.borrador).toMatchObject({ tipoViaje: "Tercerizado", unidadPlaca: null, tcVehiculoId: null, pilotoEmpleadoId: null, auxiliarEmpleadoIds: [] });
    expect(f.borrador.externo).toEqual({ pilotoExternoNombre: "Piloto Ext", auxiliaresExternos: ["A1", "A2"], unidadExternaPlaca: "X-1", unidadExternaDescripcion: "Camión", transportistaExterno: "Transp", costoTercerizado: 500, tcExternoPlaca: "TX-9" });
    expect(f.origen).toMatchObject({ pilotoNombre: "Piloto Ext", tcPlaca: "TX-9" });
  });

  it("piloto/auxiliar sin empleado vinculado: se avisa y se deja sin asignar (el usuario lo elige), no se inventa", async () => {
    const [f] = await cargar([origenRow({ piloto_empleado_id: null, piloto_nombre: "Nombre Manual" })], [{ plan_id: 900, orden: 1, id_empleado: null, nombre: "Aux Manual" }]);
    expect(f.borrador.pilotoEmpleadoId).toBeNull();
    expect(f.advertencias.join(" ")).toContain("Nombre Manual");
    expect(f.advertencias.join(" ")).toContain("Aux Manual");
  });

  it("los planes creados NO heredan historia: nacen Programado; el INSERT no incluye cierre/estado real/km/facturación/evidencias/snapshots viejos", async () => {
    await confirmar([borrador()]);
    const insert = String(conn.execute.mock.calls.find(([s]) => String(s).includes("INSERT INTO tms_planes_viaje"))![0]);
    expect(insert).toContain("'Programado'");
    for (const prohibido of ["cerrado_por", "cerrado_en", "cierre_manual", "flota_viaje", "km_", "factura", "evidencia", "bitacora", "gasto", "solicitud"]) expect(insert).not.toContain(prohibido);
    const p = creadosDestino()[0];
    expect(p.cerrado_por ?? null).toBeNull();
    expect(p.tarifa_nombre).not.toBe("VIEJA");
    // viáticos: SOLO por configuración vigente (sin overrides ni montos copiados)
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0]).toHaveLength(4); // (empresa, plan, personal, conn) — sin 5º argumento de overrides
    expect(readFileSync("src/lib/tms/programacion-copia.ts", "utf8")).not.toMatch(/tms_viaticos|monto_asignado|viatico/i);
  });

  // Emula el SELECT de validación de origen HONRANDO los predicados que aparecen en el SQL (empresa, fecha, no Cancelado).
  const origenes = [
    { id: 900, empresa_id: EMP, fecha: ORIGEN, estado: "Programado" },
    { id: 901, empresa_id: EMP, fecha: ORIGEN, estado: "Cerrado" },
    { id: 902, empresa_id: EMP, fecha: ORIGEN, estado: "Cancelado" },
    { id: 903, empresa_id: EMP, fecha: "2026-09-20", estado: "Programado" },
    { id: 904, empresa_id: 8, fecha: ORIGEN, estado: "Programado" },
  ];
  const emularValidacionOrigen = () => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      const s = String(sql);
      if (s.includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && s.includes("DATE_FORMAT(regreso_estimado")) {
        const [emp, fecha, ...ids] = params as [number, string, ...number[]];
        return origenes.filter((o) => o.empresa_id === emp && o.fecha === fecha && (!s.includes("estado <> 'Cancelado'") || o.estado !== "Cancelado") && ids.includes(o.id)).map((o) => ({ id: o.id, regreso_estimado: null }));
      }
      return base(sql, params);
    }) as never);
  };
  const desde = (ids: number[], empresa = EMP, fecha = ORIGEN) => borradoresDesdeCliente(empresa, fecha, ids.map((id, i) => ({ ...borrador({ fila: i + 1, origenPlanId: id }), paradas: undefined }) as never));

  it("borradoresDesdeCliente: el origen debe ser de ESTA empresa, de la fecha origen y NO Cancelado; las paradas se releen en el servidor", async () => {
    emularValidacionOrigen();
    const ok = await desde([900]);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.borradores[0].paradas).toHaveLength(2); // de la BD, no del cliente
    expect(await borradoresDesdeCliente(EMP, ORIGEN, [borrador({ origenPlanId: null })])).toMatchObject({ ok: false });
    expect(await borradoresDesdeCliente(EMP, ORIGEN, [borrador(), borrador({ fila: 2 })])).toMatchObject({ ok: false }); // mismo origen dos veces
  });

  it("origen CANCELADO enviado a mano -> rechazo con mensaje claro (aunque la carga inicial ya lo excluya)", async () => {
    emularValidacionOrigen();
    const r = await desde([902]);
    expect(r).toEqual({ ok: false, error: "Algún viaje origen no existe, está cancelado o no pertenece a la fecha/empresa indicada." });
    expect((await desde([900, 902])).ok).toBe(false); // uno bueno + uno cancelado: se rechaza el lote
    expect(String(vi.mocked(query).mock.calls.find(([s]) => String(s).includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && String(s).includes("DATE_FORMAT(regreso_estimado"))![0])).toContain("estado <> 'Cancelado'");
  });

  it("origen CERRADO sigue siendo válido (lo que se copia es configuración, no estado)", async () => {
    emularValidacionOrigen();
    expect(await desde([901])).toMatchObject({ ok: true });
    expect(await desde([900, 901])).toMatchObject({ ok: true });
  });

  it("origen de OTRA FECHA o de OTRA EMPRESA -> rechazo", async () => {
    emularValidacionOrigen();
    expect((await desde([903])).ok).toBe(false); // el plan es del 2026-09-20
    expect((await desde([900], EMP, "2026-09-20")).ok).toBe(false); // fecha origen indicada distinta
    expect((await desde([904])).ok).toBe(false); // plan de la empresa 8
    expect((await desde([900], 8)).ok).toBe(false); // sesión de otra empresa
  });

  it("ORIGEN cancelado ≠ DESTINO anterior cancelado: un destino Cancelado sigue permitiendo volver a copiar el mismo origen", async () => {
    emularValidacionOrigen();
    expect((await confirmar([borrador({ origenPlanId: 900 })])).ok).toBe(true);
    creadosDestino()[0].estado = "Cancelado"; // el plan DESTINO generado se cancela
    expect((await desde([900])).ok).toBe(true); // el origen (no cancelado) sigue válido
    expect((await confirmar([borrador({ origenPlanId: 900 })])).ok).toBe(true); // nueva copia permitida
    expect(e.origen).toHaveLength(2);
  });
});

// ------------------------------------------------------------------ A2.2: política por INTERVALOS en Copiar / lote
import { calcularTrasladoRegreso, regresoTrasladado, sumarDiasFecha } from "./programacion-copia-ventana";

/** Fila con ventana explícita: hora de carga + regreso trasladado (desfase en días desde la fecha_plan del origen + hora). */
const conVentana = (fila: number, hora: string | null, regreso: { dias: number; hora: string } | null, over: Partial<BorradorLote> = {}): BorradorLote =>
  borrador({
    fila, origenPlanId: 900 + fila, horaCarga: hora, regresoOffsetDias: regreso ? regreso.dias : null, regresoHora: regreso ? regreso.hora : null,
    unidadPlaca: null, pilotoEmpleadoId: 1 + fila, auxiliarEmpleadoIds: [], ...over,
  });
const estados = async (b: BorradorLote[], fecha = DESTINO) => (await validarLote(EMP, fecha, b)).map((r) => r.estado);

describe("A2.2 lote: colisiones DENTRO del lote por ventanas (no por día)", () => {
  const mismoPiloto = { pilotoEmpleadoId: 1 };

  it("1/4) dos filas secuenciales del mismo recurso: permitido, incluido el borde exacto fin == inicio", async () => {
    expect(await estados([conVentana(1, "05:00", { dias: 0, hora: "08:00" }, mismoPiloto), conVentana(2, "08:00", { dias: 0, hora: "11:00" }, mismoPiloto)])).toEqual(["ok", "ok"]);
  });

  it("2) solape de 1 minuto: bloqueado en AMBAS filas con el mensaje de siempre", async () => {
    const r = await validarLote(EMP, DESTINO, [conVentana(1, "05:00", { dias: 0, hora: "08:00" }, mismoPiloto), conVentana(2, "07:59", { dias: 0, hora: "11:00" }, mismoPiloto)]);
    expect(r.map((x) => x.estado)).toEqual(["error", "error"]);
    expect(r[0].errores[0]).toBe("Juan Pérez está asignado también en la fila 2 de este mismo lote.");
  });

  it("3) cruce de medianoche dentro del lote: 22:00 -> 02:00 (+1 día) choca con una fila 23:00 y NO con una 01:00 -> 04:00 del mismo día", async () => {
    const noche = conVentana(1, "22:00", { dias: 1, hora: "02:00" }, mismoPiloto);
    expect(await estados([noche, conVentana(2, "23:00", { dias: 1, hora: "01:00" }, mismoPiloto)])).toEqual(["error", "error"]);
    expect(await estados([noche, conVentana(2, "01:00", { dias: 0, hora: "04:00" }, mismoPiloto)])).toEqual(["ok", "ok"]);
  });

  it("5) sin regreso: reserva TODO el día y choca con cualquier fila del mismo recurso ese día", async () => {
    expect(await estados([conVentana(1, "05:00", null, mismoPiloto), conVentana(2, "20:00", { dias: 0, hora: "22:00" }, mismoPiloto)])).toEqual(["error", "error"]);
  });

  it("6) sin hora de carga: reserva TODO el día aunque traiga regreso", async () => {
    expect(await estados([conVentana(1, null, { dias: 0, hora: "08:00" }, mismoPiloto), conVentana(2, "20:00", { dias: 0, hora: "22:00" }, mismoPiloto)])).toEqual(["error", "error"]);
  });

  it("7) la misma persona como piloto en una fila y auxiliar en otra: conflicto solo si las ventanas se solapan", async () => {
    const a = conVentana(1, "05:00", { dias: 0, hora: "08:00" }, { pilotoEmpleadoId: 1 });
    expect(await estados([a, conVentana(2, "07:00", { dias: 0, hora: "10:00" }, { pilotoEmpleadoId: 2, auxiliarEmpleadoIds: [1] })])).toEqual(["error", "error"]);
    expect(await estados([a, conVentana(2, "08:00", { dias: 0, hora: "10:00" }, { pilotoEmpleadoId: 2, auxiliarEmpleadoIds: [1] })])).toEqual(["ok", "ok"]);
  });

  it("8) auxiliares adicionales (hasta 8) usan la misma comparación", async () => {
    const a = conVentana(1, "05:00", { dias: 0, hora: "08:00" }, { pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [20, 21, 22] });
    expect(await estados([a, conVentana(2, "06:00", { dias: 0, hora: "09:00" }, { pilotoEmpleadoId: 2, auxiliarEmpleadoIds: [28, 22] })])).toEqual(["error", "error"]);
    expect(await estados([a, conVentana(2, "08:00", { dias: 0, hora: "09:00" }, { pilotoEmpleadoId: 2, auxiliarEmpleadoIds: [28, 22] })])).toEqual(["ok", "ok"]);
  });

  it("9) unidad: misma placa, ventanas solapadas => conflicto; secuenciales => ok", async () => {
    const u = (fila: number, h: string, r: string) => conVentana(fila, h, { dias: 0, hora: r }, { unidadPlaca: "P-1" });
    expect(await estados([u(1, "05:00", "08:00"), u(2, "07:59", "10:00")])).toEqual(["error", "error"]);
    expect(await estados([u(1, "05:00", "08:00"), u(2, "08:00", "10:00")])).toEqual(["ok", "ok"]);
  });

  it("10) TC: misma semántica temporal que la unidad", async () => {
    const t = (fila: number, h: string, r: string) => conVentana(fila, h, { dias: 0, hora: r }, { tcVehiculoId: 31 });
    expect(await estados([t(1, "05:00", "08:00"), t(2, "07:59", "10:00")])).toEqual(["error", "error"]);
    expect(await estados([t(1, "05:00", "08:00"), t(2, "08:00", "10:00")])).toEqual(["ok", "ok"]);
  });

  it("11) Tercerizado no consume recursos internos: ni colisiona en el lote ni consulta disponibilidad", async () => {
    const ext = (fila: number) => borrador({
      fila, origenPlanId: 900 + fila, tipoViaje: "Tercerizado", unidadPlaca: null, pilotoEmpleadoId: null, auxiliarEmpleadoIds: [], horaCarga: "05:00",
      externo: { pilotoExternoNombre: "Externo", auxiliaresExternos: [], unidadExternaPlaca: "EXT-1", unidadExternaDescripcion: "", transportistaExterno: "T", costoTercerizado: null, tcExternoPlaca: "" },
    });
    vi.mocked(query).mockClear();
    expect(await estados([ext(1), ext(2)])).toEqual(["ok", "ok"]);
    expect(vi.mocked(query).mock.calls.filter(([s]) => String(s).includes("FROM tms_personal tp") || String(s).includes("FROM tms_unidades u"))).toHaveLength(0);
  });
});

describe("A2.2 lote: validación contra BD con la ventana DESTINO trasladada", () => {
  const existente = (over: Partial<Plan> = {}) => plan({ id: 50, codigo: "PLAN-50", piloto_id: 501, fecha: DESTINO, hora: "05:00", regreso: `${DESTINO} 08:00:00`, ...over });

  it("05:00-08:00 existente: la fila 08:00-11:00 pasa y la 07:59-11:00 choca (piloto)", async () => {
    e.planes.push(existente());
    expect(await estados([conVentana(1, "08:00", { dias: 0, hora: "11:00" }, { pilotoEmpleadoId: 1 })])).toEqual(["ok"]);
    const r = await validarLote(EMP, DESTINO, [conVentana(1, "07:59", { dias: 0, hora: "11:00" }, { pilotoEmpleadoId: 1 })]);
    expect(r[0]).toMatchObject({ estado: "error", errores: ["El piloto Juan Pérez ya está asignado al PLAN-50 para el 25/09/2026."] });
  });

  it("cruce de medianoche contra BD: existente de ayer 22:00 -> hoy 02:00; fila 01:00 choca, 02:00 no", async () => {
    e.planes.push(existente({ fecha: ORIGEN, hora: "22:00", regreso: `${DESTINO} 02:00:00` }));
    expect(await estados([conVentana(1, "01:00", { dias: 0, hora: "04:00" }, { pilotoEmpleadoId: 1 })])).toEqual(["error"]);
    expect(await estados([conVentana(1, "02:00", { dias: 0, hora: "05:00" }, { pilotoEmpleadoId: 1 })])).toEqual(["ok"]);
  });

  it("existente SIN regreso (o sin hora) reserva todo su día: la fila choca aunque sea de otra hora, y no toca el día siguiente", async () => {
    e.planes.push(existente({ regreso: null }));
    expect(await estados([conVentana(1, "20:00", { dias: 0, hora: "22:00" }, { pilotoEmpleadoId: 1 })])).toEqual(["error"]);
    expect(await estados([conVentana(1, "01:00", { dias: 0, hora: "03:00" }, { pilotoEmpleadoId: 1 })], "2026-09-26")).toEqual(["ok"]);
  });

  it("auxiliar, unidad y TC contra BD usan la misma comparación (07:59 choca, 08:00 pasa)", async () => {
    e.planes.push(existente({ piloto_id: null, aux: [502], unidad_id: 601, tc_vehiculo_id: 31 }));
    for (const recurso of [{ pilotoEmpleadoId: 3, auxiliarEmpleadoIds: [2] }, { unidadPlaca: "P-1" }, { tcVehiculoId: 31 }]) {
      expect(await estados([conVentana(1, "07:59", { dias: 0, hora: "10:00" }, recurso)])).toEqual(["error"]);
      expect(await estados([conVentana(1, "08:00", { dias: 0, hora: "10:00" }, recurso)])).toEqual(["ok"]);
    }
  });

  it("un plan Cancelado no bloquea; uno Cerrado sigue reservando su ventana", async () => {
    e.planes.push(existente({ estado: "Cancelado" }));
    expect(await estados([conVentana(1, "06:00", { dias: 0, hora: "07:00" }, { pilotoEmpleadoId: 1 })])).toEqual(["ok"]);
    e.planes[e.planes.length - 1].estado = "Cerrado";
    expect(await estados([conVentana(1, "06:00", { dias: 0, hora: "07:00" }, { pilotoEmpleadoId: 1 })])).toEqual(["error"]);
  });

  it("la consulta usa el motor por intervalos (ventana) y nunca la política diaria por fecha exacta", async () => {
    vi.mocked(query).mockClear();
    await estados([conVentana(1, "08:00", { dias: 0, hora: "11:00" }, { pilotoEmpleadoId: 1 })]);
    const sql = vi.mocked(query).mock.calls.map(([s]) => String(s)).find((s) => s.includes("FROM tms_personal tp"))!;
    expect(sql).toContain("p.fecha_plan <= ?");
    expect(sql).not.toContain("p.fecha_plan = ?");
  });

  it("confirmar revalida bajo el candado y persiste el regreso TRASLADADO (no el literal del origen)", async () => {
    const r = await confirmar([conVentana(1, "22:00", { dias: 1, hora: "02:00" }, { pilotoEmpleadoId: 1 })], "2026-09-30");
    expect(r.ok).toBe(true);
    const creado = e.planes.find((p) => p.id >= 1000)!;
    expect([creado.fecha, creado.hora, creado.regreso]).toEqual(["2026-09-30", "22:00", "2026-10-01 02:00"]);
  });

  it("confirmar: un conflicto aparecido bajo el candado revierte todo el lote (todo o nada)", async () => {
    e.planes.push(existente());
    const r = await confirmar([conVentana(1, "10:00", { dias: 0, hora: "12:00" }, { pilotoEmpleadoId: 2 }), conVentana(2, "07:00", { dias: 0, hora: "09:00" }, { pilotoEmpleadoId: 1 })]);
    expect(r.ok).toBe(false);
    expect(e.planes.filter((p) => p.id >= 1000)).toHaveLength(0);
  });
});

describe("A2.2 copiar: traslado del regreso estimado", () => {
  it("12) mismo día: 24/09 -> 24/09 17:30 copiado al 30/09 => 30/09 17:30", () => {
    const t = calcularTrasladoRegreso("2026-09-24", "2026-09-24 17:30:00");
    expect(t).toEqual({ offsetDias: 0, hora: "17:30" });
    expect(regresoTrasladado("2026-09-30", t)).toBe("2026-09-30T17:30");
  });

  it("13) +1 día: 24/09 22:00 -> 25/09 02:00 copiado al 30/09 => 01/10 02:00 (NO 25/09)", () => {
    const t = calcularTrasladoRegreso("2026-09-24", "2026-09-25 02:00:00");
    expect(t).toEqual({ offsetDias: 1, hora: "02:00" });
    expect(regresoTrasladado("2026-09-30", t)).toBe("2026-10-01T02:00");
  });

  it("14) +2 días: 24/09 -> 26/09 05:00 copiado al 30/09 => 02/10 05:00", () => {
    const t = calcularTrasladoRegreso("2026-09-24", "2026-09-26T05:00");
    expect(t).toEqual({ offsetDias: 2, hora: "05:00" });
    expect(regresoTrasladado("2026-09-30", t)).toBe("2026-10-02T05:00");
  });

  it("15) cambio de mes (y febrero bisiesto)", () => {
    expect(regresoTrasladado("2026-09-30", { offsetDias: 1, hora: "02:00" })).toBe("2026-10-01T02:00");
    expect(regresoTrasladado("2028-02-28", { offsetDias: 1, hora: "02:00" })).toBe("2028-02-29T02:00");
    expect(regresoTrasladado("2026-02-28", { offsetDias: 1, hora: "02:00" })).toBe("2026-03-01T02:00");
  });

  it("16) cambio de año", () => {
    expect(regresoTrasladado("2026-12-31", { offsetDias: 1, hora: "02:00" })).toBe("2027-01-01T02:00");
    expect(regresoTrasladado("2026-12-30", { offsetDias: 2, hora: "05:00" })).toBe("2027-01-01T05:00");
    expect(sumarDiasFecha("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("sin regreso (o incoherente) => null: la copia queda sin regreso (reserva diaria)", () => {
    expect(calcularTrasladoRegreso("2026-09-24", null)).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "")).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "2026-09-23 10:00:00")).toBeNull(); // antes de la fecha de salida
    expect(calcularTrasladoRegreso("2026-09-24", "basura")).toBeNull();
    expect(regresoTrasladado("2026-09-30", null)).toBeNull();
  });

  const origenRow = (regreso: string | null) => ({
    id: 900, codigo: "PLAN-20260924-001", estado: "Programado", cliente_id: 3, cliente_nombre: "Acme", ruta_id: 10, ruta_codigo_historico: "1001", hora_carga: "22:00:00", regreso_estimado: regreso, tipo_traslado: "Carga",
    tipo_viaje: "Propio", unidad_placa: "P-1", tc_vehiculo_id: null, tc_placa_historica: null, tc_externo_placa: null, piloto_empleado_id: 1, piloto_nombre: "Juan Pérez",
    aux1_empleado_id: null, aux1_nombre: null, piloto_externo_nombre: null, auxiliares_externos: null, unidad_externa_placa: null, unidad_externa_descripcion: null, transportista_externo: null, costo_tercerizado: null,
  });
  const cargarOrigen = async (regreso: string | null) => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      const s = String(sql);
      if (s.includes("LEFT JOIN tms_clientes c") && s.includes("p.fecha_plan = ?")) return [origenRow(regreso)];
      if (s.includes("FROM tms_plan_auxiliares pa")) return [];
      return base(sql, params);
    }) as never);
    return cargarCopiaDeFecha(EMP, ORIGEN);
  };

  it("la carga de la fecha origen deriva desfase y hora del regreso del ORIGEN (servidor)", async () => {
    const [con] = await cargarOrigen("2026-09-25 02:00:00");
    expect(con.borrador).toMatchObject({ horaCarga: "22:00", regresoOffsetDias: 1, regresoHora: "02:00" });
    const [sin] = await cargarOrigen(null);
    expect(sin.borrador).toMatchObject({ regresoOffsetDias: null, regresoHora: null });
    expect(String(vi.mocked(query).mock.calls.find(([s]) => String(s).includes("LEFT JOIN tms_clientes c"))![0])).toContain("DATE_FORMAT(p.regreso_estimado");
  });

  it("borradoresDesdeCliente recalcula el traslado desde el origen y IGNORA lo que mande el cliente", async () => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      if (String(sql).includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && String(sql).includes("DATE_FORMAT(regreso_estimado")) return [{ id: 900, regreso_estimado: "2026-09-26 05:00:00" }];
      return base(sql, params);
    }) as never);
    const falso = { ...borrador({ origenPlanId: 900 }), regresoOffsetDias: 9, regresoHora: "23:59" } as never;
    const r = await borradoresDesdeCliente(EMP, ORIGEN, [falso]);
    expect(r.ok && r.borradores[0]).toMatchObject({ regresoOffsetDias: 2, regresoHora: "05:00" });
  });

  it("el cuerpo que arma la pantalla de Copiar no envía los campos de traslado (el esquema estricto los rechazaría)", async () => {
    const { cuerpoLote } = await import("../../app/e/[slug]/programacion/copiar/copiar-helpers");
    const cuerpo = cuerpoLote(ORIGEN, DESTINO, [{ incluida: true, origen: {} as never, advertencias: [], borrador: { ...borrador(), regresoOffsetDias: 1, regresoHora: "02:00" }, validacion: null, sucia: false }]);
    const claves = Object.keys(cuerpo.filas[0]);
    expect(claves).not.toContain("regresoOffsetDias");
    expect(claves).not.toContain("regresoHora");
    expect(claves).not.toContain("paradas");
  });
});
