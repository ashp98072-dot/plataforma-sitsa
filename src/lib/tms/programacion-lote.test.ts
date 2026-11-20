// Por omisión el motor usa el adaptador SIMULADO de la unidad (upsert permisivo). Las pruebas «identidad TMS REAL» activan `unidadReal.modelo` y ejecutan el resolvedor REAL de #624 sobre un modelo SQL sintético.
const unidadReal = vi.hoisted(() => ({ modelo: null as null | { consultar(sql: string, a?: unknown[]): Record<string, unknown>[] | undefined; insertar(sql: string, a: unknown[], id: number): void; modelo: { unidades: { id: number; empresa_id: number; placa: string; flota_vehiculo_id: number | null }[] } } }));
vi.mock("@/lib/tms/unidad-canonica", async () => {
  const sim = (await import("./unidad-canonica.test-fixture")).unidadEnSimulador;
  const real = await vi.importActual<typeof import("./unidad-canonica")>("./unidad-canonica");
  return {
    resolverUnidadTmsTx: (...a: Parameters<typeof sim>) => (unidadReal.modelo ? real.resolverUnidadTmsTx(...a) : sim(...a)),
    // Vista previa: por omisión no hay identidad que verificar (equivale a «sin conflicto»); con `unidadReal.modelo` corre el resolvedor REAL de LECTURA sobre el modelo SQL.
    resolverUnidadTmsSoloLectura: (...a: Parameters<typeof real.resolverUnidadTmsSoloLectura>) => (unidadReal.modelo ? real.resolverUnidadTmsSoloLectura(...a) : Promise.resolve(null)),
  };
});
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modeloSqlUnidadTms } from "./unidad-canonica-sql.fixture";
import { ErrorVistaPrevia } from "./lector-vista-previa";
import { huellaAvisosCopia } from "./programacion-copia-avisos";
import { ErrorCB2 } from "@/lib/flota/cb2/model";

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
vi.mock("@/lib/tms/codigo-plan", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tms/codigo-plan")>("@/lib/tms/codigo-plan");
  // Se mantiene REAL esDuplicadoCodigoPlan (es pura, y las pruebas de PR (bugfix copia masiva) dependen de su
  // criterio real ER_DUP_ENTRY/errno 1062); solo se mockea la generación de código en sí.
  return { ...actual, asegurarCodigoPlanUnicoTx: vi.fn() };
});

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
import { asegurarCodigoPlanUnicoTx, esDuplicadoCodigoPlan } from "@/lib/tms/codigo-plan";
void esDuplicadoCodigoPlan; // real (no mockeada); referenciada para dejar claro que no se reemplaza
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
  auxiliar_id: number | null; aux: number[]; extra?: number | null; tc_vehiculo_id: number | null; tipo_viaje: string; ruta_id: number | null;
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
// PROGRAMACION-COPIA-LOTE-TX-1 — cola de fallos SIMULADOS del INSERT de tms_planes_viaje, consumidos en orden (uno
// por intento de INSERT): permite reproducir, dentro de la MISMA transacción del lote, una colisión real de
// código (ER_DUP_ENTRY) que debe reintentar, o cualquier otro error de INSERT que debe propagarse tal cual.
let insertPlanFallos: ("ok" | "dup" | "otro" | "guarda")[] = [];
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() };

const flota: Record<number, { id: number; placa: string; activo: number; en_taller: number; tipo_unidad: string; empresa_id: number }> = {
  31: { id: 31, placa: "TC-1", activo: 1, en_taller: 0, tipo_unidad: "TC", empresa_id: 7 },
  32: { id: 32, placa: "TC-2", activo: 1, en_taller: 0, tipo_unidad: "TC", empresa_id: 7 },
};
const empleados: Record<number, { id: number; nombre: string; estado: string; puesto?: string }> = {
  1: { id: 1, nombre: "Juan Pérez", estado: "Activo" }, 2: { id: 2, nombre: "Ana López", estado: "Activo" }, 3: { id: 3, nombre: "Beto Ruiz", estado: "Activo" },
  4: { id: 4, nombre: "Carla Díaz", estado: "Activo" }, 5: { id: 5, nombre: "Inactivo Uno", estado: "Baja", puesto: "Piloto" },
  // PILOTO EXTRA: 6 y 7 son pilotos (puesto de piloto); 8 es un auxiliar (no puede ser piloto extra).
  6: { id: 6, nombre: "Extra Piloto", estado: "Activo", puesto: "Piloto" }, 7: { id: 7, nombre: "Otro Piloto", estado: "Activo", puesto: "Piloto" }, 8: { id: 8, nombre: "Solo Auxiliar", estado: "Activo", puesto: "Auxiliar" },
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
  pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], tarifaId: null, externo: null, paradas: [], vehiculoSolicitadoPerfilId: 11, ...over,
});

const origenesSinVehiculo = new Set<number>();

beforeEach(() => {
  vi.resetAllMocks();
  origenesSinVehiculo.clear();
  sinTablaOrigen = false;
  falla = { en: null, enPlanNumero: 0 };
  insertPlanFallos = [];
  e = {
    planes: [], origen: [], auxiliares: [], paradas: [], viaticos: [], auditorias: [],
    personal: [{ id: 501, id_empleado: 1, nombre: "Juan Pérez" }, { id: 502, id_empleado: 2, nombre: "Ana López" }],
    unidades: [{ id: 601, placa: "P-1" }, { id: 602, placa: "P-2" }], sigPlan: 1000, sigPersonal: 700, sigCodigo: 1,
  };
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [vehiculo(1, "P-1", "VEHICULO"), vehiculo(2, "P-2", "VEHICULO"), vehiculo(3, "P-3", "VEHICULO", { puedeEnviar: false, motivoNoDisponible: "En taller" }), vehiculo(31, "TC-1", "TC"), vehiculo(32, "TC-2", "TC")] } as never);
  vi.mocked(listarDisponibilidadPersonal).mockResolvedValue([]);
  vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (empresa: number, id: number) => (flota[id] && flota[id].empresa_id === empresa ? flota[id] : null)) as never);
  vi.mocked(tarifasActivasDeVariasRutas).mockImplementation((async (_e: number, ids: number[]) => new Map([...tarifas].filter(([id]) => ids.includes(id)))) as never);
  vi.mocked(asegurarCodigoPlanUnicoTx).mockImplementation((async () => `PLAN-NUEVO-${String(e.sigCodigo++).padStart(3, "0")}`) as never);
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
    // Catálogo de perfiles de vehículo solicitado: SOLO el 11 (activo) de la empresa EMP; el 12 está inactivo y el 99 es de otra empresa.
    if (s.includes("FROM tms_cotizacion_costeo_perfiles")) { const [emp, ...pids] = params as number[]; return emp === EMP ? pids.filter((i) => i === 11).map((i) => ({ id: i, nombre: "Camión 2.5 toneladas" })) : []; }
    // Vehículo solicitado de los viajes ORIGEN (lectura aparte de borradoresDesdeCliente): en este escenario todos tienen el perfil 11, salvo los ids de `origenesSinVehiculo`.
    if (s.includes("SELECT id, vehiculo_solicitado_perfil_id FROM tms_planes_viaje")) { const [, ...pids] = params as number[]; return pids.map((id) => ({ id, vehiculo_solicitado_perfil_id: origenesSinVehiculo.has(id) ? null : 11 })); }
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
        return e.planes.filter((p) => ocupa(p) && ((p.piloto_id != null && eq.has(p.piloto_id)) || (p.extra != null && eq.has(p.extra)) || p.aux.some((a) => eq.has(a)))).map((p) => fila(p, tp.id, tp.nombre));
      });
    }
    if (s.includes("FROM tms_unidades u")) return e.planes.filter((p) => ocupa(p) && p.unidad_id != null && ids.includes(p.unidad_id)).map((p) => fila(p, p.unidad_id, e.unidades.find((u) => u.id === p.unidad_id)?.placa));
    if (s.includes("p.tc_vehiculo_id = v.id")) return e.planes.filter((p) => ocupa(p) && p.tc_vehiculo_id != null && ids.includes(p.tc_vehiculo_id)).map((p) => fila(p, p.tc_vehiculo_id, flota[p.tc_vehiculo_id as number]?.placa));
    return [];
  }) as never);

  // ---- transacción con respaldo/restauración ----
  conn.beginTransaction.mockImplementation(async () => { respaldo = JSON.stringify(e); });
  conn.rollback.mockImplementation(async () => { e = JSON.parse(respaldo); });
  unidadReal.modelo = null;
  conn.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (String(sql).includes("GET_LOCK")) return [[{ l: 1 }]];
    const unidad = unidadReal.modelo?.consultar(String(sql), args); if (unidad !== undefined) return [unidad];
    return [[]];
  });
  conn.execute.mockImplementation(async (sql: string, p: unknown[]) => {
    const s = String(sql);
    if (unidadReal.modelo && s === "INSERT INTO tms_unidades(empresa_id,placa,tipo,flota_vehiculo_id) VALUES(?,?,?,?)") {
      unidadReal.modelo.insertar(s, p, 900 + unidadReal.modelo.modelo.unidades.length); return [{ insertId: 0 }];   // insertId 0 a propósito (causa raíz de #619): el resolvedor relee por SELECT
    }
    if (s.includes("INSERT INTO tms_unidades")) {
      const placa = p[1] as string;
      let u = e.unidades.find((x) => x.placa === placa);
      if (!u) { u = { id: 800 + e.unidades.length, placa }; e.unidades.push(u); }
      return [{ insertId: u.id }];
    }
    if (s.includes("INSERT INTO tms_planes_viaje")) {
      const tipoFallo = insertPlanFallos.shift();
      if (tipoFallo === "dup") throw Object.assign(new Error("Duplicate entry '7-PLAN-NUEVO-001' for key 'uq_plan'"), { code: "ER_DUP_ENTRY", errno: 1062 });
      if (tipoFallo === "otro") throw Object.assign(new Error("ER_NO_REFERENCED_ROW: cliente_id no existe"), { code: "ER_NO_REFERENCED_ROW_2", errno: 1452 });
      // URGENTE — la guarda BEFORE INSERT de fusiones de flota (SQLSTATE 45000) reproducida contra MariaDB (planes-codigo-unico.db.test.ts).
      if (tipoFallo === "guarda") {
        const sqlMessage = "Seleccione la unidad principal: ID fusionado";
        throw Object.assign(new Error(sqlMessage), { code: "ER_SIGNAL_EXCEPTION", errno: 1644, sqlState: "45000", sqlMessage });
      }
      const id = e.sigPlan++;
      e.planes.push(plan({ id, codigo: p[1] as string, cliente_id: p[2] as number | null, unidad_id: p[5] as number | null, piloto_id: p[6] as number | null, auxiliar_id: p[7] as number | null,
        fecha: p[8] as string, hora: p[9] as string | null, regreso: p[11] as string | null, tarifa_comercial: p[12] as number | null, tarifa_id: p[13] as number | null, tarifa_nombre: p[14] as string | null, ruta_id: p[17] as number | null,
        tipo_viaje: p[23] as string, piloto_externo: p[24] as string | null, unidad_ext: p[26] as string | null, tc_vehiculo_id: p[30] as number | null, tc_placa: p[31] as string | null, tc_externo: p[32] as string | null,
        aux: [] }));
      return [{ insertId: id }];
    }
    if (s.includes("INSERT INTO tms_plan_pilotos_adicionales")) {
      const pl = e.planes.find((x) => x.id === p[1]);
      if (pl) pl.extra = p[2] as number;
      return [{ affectedRows: 1 }];
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
const confirmar = (b: BorradorLote[], fecha = DESTINO, avisosAceptados?: string) => confirmarLote(EMP, "jefe", fecha, { tipo: "COPIA", fechaOrigen: ORIGEN }, b, undefined, avisosAceptados);
/** Confirma como lo hace la pantalla cuando el usuario ACEPTA los avisos: usa la huella que el servidor calculó en la validación. */
const huellaDe = async (b: BorradorLote[], fecha = DESTINO) => huellaAvisosCopia({ empresaId: EMP, fechaOrigen: ORIGEN, fechaDestino: fecha }, (await validarLote(EMP, fecha, b)).map((r) => ({ fila: r.fila, avisos: r.avisos })));
const confirmarAceptando = async (b: BorradorLote[], fecha = DESTINO) => confirmar(b, fecha, (await huellaDe(b, fecha)) || undefined);

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

  it("VEHÍCULO SOLICITADO: la copia lo hereda del origen y lo guarda en el MISMO INSERT (id + nombre vigente del catálogo)", async () => {
    const r = await confirmar([borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "P-1", pilotoEmpleadoId: 1, vehiculoSolicitadoPerfilId: 11 })]);
    expect(r.ok).toBe(true);
    const insert = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje"))!;
    expect(String(insert[0])).toContain("vehiculo_solicitado_perfil_id, vehiculo_solicitado_nombre)");
    expect((insert[1] as unknown[]).slice(-2)).toEqual([11, "Camión 2.5 toneladas"]);
    expect((String(insert[0]).match(/\?/g) ?? []).length).toBe((insert[1] as unknown[]).length);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("SET vehiculo_solicitado_perfil_id"))).toBe(false); // nunca se crea el plan y luego se completa
  });

  it("VEHÍCULO SOLICITADO: origen SIN vehículo, perfil inactivo, inexistente o de otra empresa → el lote NO crea nada (antes de cualquier INSERT) y el mensaje es claro", async () => {
    for (const [perfil, texto] of [[null, /no tiene vehículo solicitado/], [12, /ya no existe en el catálogo.*inactivo/], [99, /ya no existe en el catálogo/], [5555, /ya no existe en el catálogo/]] as const) {
      const lote = [
        borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "P-1", pilotoEmpleadoId: 1, vehiculoSolicitadoPerfilId: 11 }), // esta fila sola sería válida
        borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3, vehiculoSolicitadoPerfilId: perfil }),
      ];
      const validacion = await validarLote(EMP, DESTINO, lote);
      expect(validacion[0].estado).toBe("ok");
      expect(validacion[1].estado).toBe("error");
      expect(validacion[1].errores.join(" ")).toMatch(texto);
      const antes = creadosDestino().length;
      const r = await confirmar(lote);
      expect(r.ok).toBe(false);
      expect(creadosDestino().length).toBe(antes); // todo o nada: ni siquiera la fila válida
      expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje"))).toBe(false);
      conn.execute.mockClear();
    }
  });

  it("VEHÍCULO SOLICITADO: borradoresDesdeCliente lo lee del ORIGEN en el servidor (ignora lo que mande el cliente) y un origen histórico produce borrador sin vehículo → bloqueado", async () => {
    const { borradoresDesdeCliente } = await import("./programacion-copia");
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      if (String(sql).includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && String(sql).includes("hora_carga, DATE_FORMAT(regreso_estimado")) return [{ id: 900, hora_carga: "08:00:00", regreso_estimado: null }, { id: 901, hora_carga: "09:00:00", regreso_estimado: null }];
      return base(sql, params);
    }) as never);
    origenesSinVehiculo.add(901);
    const r = await borradoresDesdeCliente(EMP, ORIGEN, [
      { ...borrador({ fila: 1, origenPlanId: 900 }), vehiculoSolicitadoPerfilId: 77 } as never, // el cliente intenta colar otro perfil
      { ...borrador({ fila: 2, origenPlanId: 901 }), vehiculoSolicitadoPerfilId: 11 } as never, // y a un origen histórico le inventa uno
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.borradores.map((b) => b.vehiculoSolicitadoPerfilId)).toEqual([11, null]); // lo del origen, nunca lo del cliente
    expect((await validarLote(EMP, DESTINO, r.borradores))[1].errores.join(" ")).toMatch(/no tiene vehículo solicitado/);
  });

  it("VEHÍCULO SOLICITADO: nunca se infiere de la unidad, la placa ni la tarifa", () => {
    const src = readFileSync("src/lib/tms/programacion-lote.ts", "utf8");
    expect(src).not.toMatch(/vehiculo\s*=\s*[^;]*(unidad|placa|tarifa)/i);
    expect(src).toContain("r.vehiculo!.id, r.vehiculo!.nombre");
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
  it.each([{ id: 100, monto: 1499, moneda: "GTQ" }, { id: 101, monto: 1500, moneda: "GTQ" }, { id: 100, monto: 1500, moneda: "USD" }])("rechaza cambios de tarifa antes de escribir", async (tarifa) => {
    const r = await confirmarLote(EMP, "jefe", DESTINO, { tipo: "COPIA", fechaOrigen: ORIGEN }, [borrador()], [{ fila: 1, tarifa }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erroresPorFila?.[0].errores.join(" ")).toContain("tarifa vigente cambió");
    expect(creadosDestino()).toHaveLength(0);
  });
  it("una expectativa ausente, o 'sin tarifa' cuando hoy hay tarifa vigente, también se rechaza sin escribir (solicitud manipulada o desactualizada)", async () => {
    const origen = { tipo: "COPIA" as const, fechaOrigen: ORIGEN };
    for (const esperadas of [[], [{ fila: 2, tarifa: { id: 100, monto: 1500, moneda: "GTQ" } }], [{ fila: 1, tarifa: null }]]) {
      const r = await confirmarLote(EMP, "jefe", DESTINO, origen, [borrador()], esperadas);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.erroresPorFila?.[0].errores.join(" ")).toContain("tarifa vigente cambió");
    }
    expect(creadosDestino()).toHaveLength(0);
  });
  it("tras el rechazo, el usuario revalida y confirma con la tarifa actualizada: nada se escribió antes y ahora se crea una sola copia", async () => {
    const origen = { tipo: "COPIA" as const, fechaOrigen: ORIGEN };
    const rechazo = await confirmarLote(EMP, "jefe", DESTINO, origen, [borrador()], [{ fila: 1, tarifa: { id: 100, monto: 1499, moneda: "GTQ" } }]);
    expect(rechazo.ok).toBe(false);
    expect(creadosDestino()).toHaveLength(0);
    const [revalidada] = await validarLote(EMP, DESTINO, [borrador()]); // lo que hace «Revalidar»: trae la tarifa vigente
    expect(revalidada.tarifa).toMatchObject({ id: 100, monto: 1500, moneda: "GTQ" });
    const ok = await confirmarLote(EMP, "jefe", DESTINO, origen, [borrador()], [{ fila: 1, tarifa: { id: revalidada.tarifa!.id, monto: revalidada.tarifa!.monto, moneda: revalidada.tarifa!.moneda } }]);
    expect(ok.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(1);
    expect(creadosDestino()[0]).toMatchObject({ tarifa_comercial: 1500, tarifa_id: 100 }); // el importe sale del catálogo vigente, no de lo enviado
  });
  it("puede elegir OTRA tarifa vigente de la ruta", async () => {
    await confirmar([borrador({ tarifaId: 101 })]);
    expect(creadosDestino()[0]).toMatchObject({ tarifa_comercial: 1800, tarifa_id: 101, tarifa_nombre: "Refrigerado" });
  });
  it("una tarifa que no es vigente de ESA ruta (o de otra ruta) se rechaza: no hay monto libre", async () => {
    const r = await validarLote(EMP, DESTINO, [borrador({ tarifaId: 110 }), borrador({ fila: 2, origenPlanId: 901, tarifaId: 99999 })]);
    expect(r.map((x) => x.estado)).toEqual(["error", "error"]);
    expect(r[0].errores[0]).toContain("no es una tarifa vigente de esta ruta");
    expect(readFileSync("src/lib/tms/programacion-copia-schema.ts", "utf8")).not.toMatch(/tarifaComercial/);
  });
  it("ruta sin tarifa vigente NO bloquea (se copia sin tarifa); ruta inactiva/inexistente -> error", async () => {
    const r = await validarLote(EMP, DESTINO, [borrador({ rutaId: 12 }), borrador({ fila: 2, origenPlanId: 901, rutaId: 13, unidadPlaca: "P-2", pilotoEmpleadoId: 2 }), borrador({ fila: 3, origenPlanId: 902, rutaId: 99, unidadPlaca: null, pilotoEmpleadoId: 3 })]);
    expect(r[0].errores).toEqual([]);
    expect(r[0]).toMatchObject({ estado: "ok", tarifa: null });
    expect(r[1].errores[0]).toContain("inactiva");
    expect(r[2].errores[0]).toContain("no existe");
  });
  it("el origen aporta SOLO la referencia de tarifa al borrador; los montos/nombres históricos jamás entran al borrador (solo se muestran en `origen.tarifaOriginal`)", async () => {
    const src = readFileSync("src/lib/tms/programacion-copia.ts", "utf8");
    expect(src).toContain("p.tarifa_id != null ? Number(p.tarifa_id) : null");
    expect(src).toContain("tarifaOriginal:");
    expect(src).not.toMatch(/tarifa_monto_historico|tarifa_nombre_historico/);
    const bloqueBorrador = src.slice(src.indexOf("const borrador"), src.indexOf("origen: {"));
    expect(bloqueBorrador).not.toMatch(/tarifa_comercial|tarifa_monto|tarifa_nombre|tarifa_moneda/);   // el borrador no toca montos históricos
    expect(readFileSync("src/lib/tms/programacion-copia-schema.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/tarifaOriginal|tarifaMonto|tarifa_monto/i);   // y el cliente no puede enviar la tarifa del origen
  });
});

describe("disponibilidad (política diaria REAL) y colisiones dentro del lote", () => {
  const ocupar = (over: Partial<Plan>) => e.planes.push(plan({ id: 50, codigo: "PLAN-EXISTENTE", ...over }));
  // COPIA FIEL AL ORIGEN (decisión del propietario): que el recurso ya tenga otro viaje en la fecha destino NO bloquea; se avisa y la fila se crea igual.
  it("piloto ocupado el mismo día por un viaje existente: AVISO (no bloquea)", async () => {
    ocupar({ piloto_id: 501 });
    const r = await validarLote(EMP, DESTINO, [borrador({ pilotoEmpleadoId: 1 })]);
    expect(r[0]).toMatchObject({ estado: "ok", errores: [] });
    expect(r[0].avisos).toEqual([{ tipo: "destino_ocupado", recurso: { tipo: "piloto", id: "501" }, ocupadoPor: { planId: 50 }, mensaje: "El piloto Juan Pérez ya está asignado al PLAN-EXISTENTE para el 25/09/2026. Se copia igual que el origen." }]);
  });
  it("auxiliar ocupado: aviso", async () => {
    ocupar({ aux: [502] });
    const r = await validarLote(EMP, DESTINO, [borrador({ auxiliarEmpleadoIds: [2] })]);
    expect(r[0].estado).toBe("ok");
    expect(r[0].avisos?.[0]).toMatchObject({ tipo: "destino_ocupado", mensaje: expect.stringContaining("Ana López ya está asignado") });
  });
  it("unidad ocupada: aviso", async () => {
    ocupar({ unidad_id: 601 });
    const r = (await validarLote(EMP, DESTINO, [borrador()]))[0];
    expect(r.estado).toBe("ok");
    expect(r.avisos?.[0].mensaje).toBe("La unidad P-1 ya está asignada al PLAN-EXISTENTE para el 25/09/2026. Se copia igual que el origen.");
  });
  it("TC ocupado: aviso", async () => {
    ocupar({ tc_vehiculo_id: 31 });
    const r = (await validarLote(EMP, DESTINO, [borrador({ tcVehiculoId: 31 })]))[0];
    expect(r.estado).toBe("ok");
    expect(r.avisos?.[0].mensaje).toBe("El TC TC-1 ya está asignado al PLAN-EXISTENTE para el 25/09/2026. Se copia igual que el origen.");
  });
  it("un viaje Cancelado o de otra fecha/empresa NO ocupa el recurso", async () => {
    ocupar({ piloto_id: 501, estado: "Cancelado" });
    ocupar({ id: 51, piloto_id: 501, fecha: "2026-09-26" });
    ocupar({ id: 52, piloto_id: 501, empresa_id: 8 });
    expect((await validarLote(EMP, DESTINO, [borrador()]))[0].estado).toBe("ok");
  });
  it("recursos repetidos ENTRE dos filas SIN regreso (piloto, unidad y TC): se copian igual, con aviso en ambas y la fila del otro", async () => {
    const r = await validarLote(EMP, DESTINO, [
      borrador({ fila: 1, origenPlanId: 900, unidadPlaca: "P-1", tcVehiculoId: 31, pilotoEmpleadoId: 1 }),
      borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-1", tcVehiculoId: 31, pilotoEmpleadoId: 1 }),
    ]);
    expect(r.map((x) => x.estado)).toEqual(["ok", "ok"]);
    expect(r[0].avisos?.every((a) => a.tipo === "ventana_incompleta")).toBe(true);
    const txt = (r[0].avisos ?? []).map((a) => a.mensaje).join(" | ");
    expect(txt).toContain("Juan Pérez está asignado también en la fila 2");
    expect(txt).toContain("La unidad P-1 está asignada también en la fila 2");
    expect(txt).toContain("El TC #31 está asignado también en la fila 2");
    expect(txt).toContain("Se copia igual que el origen.");
    expect((r[1].avisos ?? []).map((a) => a.mensaje).join(" ")).toContain("fila 1");
  });
  it("cambio DESPUÉS de la preview: otro viaje ocupó el recurso => la copia se crea igual (aviso, no bloqueo)", async () => {
    expect((await validarLote(EMP, DESTINO, [borrador()]))[0]).toMatchObject({ estado: "ok" });
    ocupar({ piloto_id: 501 }); // otro usuario programó al piloto entre tanto
    expect((await validarLote(EMP, DESTINO, [borrador()]))[0].avisos?.[0].tipo).toBe("destino_ocupado");
    const r = await confirmarAceptando([borrador()]);
    expect(r.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(1);
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
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toEqual({ piloto: null, pilotoExtra: null, auxiliares: [] });
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

describe("PROGRAMACION-COPIA-LOTE-TX-1 — bugfix: copia masiva (regresión 'uno por uno funciona, varios juntos fallan')", () => {
  it("1) copiar 1 plan sigue funcionando", async () => {
    const r = await confirmar([borrador()]);
    expect(r).toMatchObject({ ok: true, codigos: ["PLAN-NUEVO-001"] });
    expect(creadosDestino()).toHaveLength(1);
  });
  it("2-3) copiar 6 planes de una vez genera 6 códigos DISTINTOS y secuenciales (reproduce el bug: antes fallaba con 'no se pudo generar un código de plan único')", async () => {
    const pilotos = [1, 2, 3, 4, 6, 7]; // 6 pilotos DISTINTOS (mismo día: dos filas con el mismo piloto es un conflicto real, no del bug de código)
    const lote = Array.from({ length: 6 }, (_, i) => borrador({ fila: i + 1, origenPlanId: 900 + i, unidadPlaca: null, pilotoEmpleadoId: pilotos[i] }));
    const r = await confirmar(lote);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.codigos).toHaveLength(6);
      expect(new Set(r.codigos).size).toBe(6); // 4) secuenciales y sin repetir dentro del lote
      expect(r.codigos).toEqual(["PLAN-NUEVO-001", "PLAN-NUEVO-002", "PLAN-NUEVO-003", "PLAN-NUEVO-004", "PLAN-NUEVO-005", "PLAN-NUEVO-006"]);
    }
    expect(creadosDestino()).toHaveLength(6);
    expect(conn.commit).toHaveBeenCalledTimes(1); // 10) commit único
    expect(vi.mocked(asegurarCodigoPlanUnicoTx)).toHaveBeenCalledTimes(6); // una vez por fila, con la MISMA conn
    for (const [connArg] of vi.mocked(asegurarCodigoPlanUnicoTx).mock.calls) expect(connArg).toBe(conn);
  });
  it("7) ER_DUP_ENTRY real (colisión de código) -> reintenta con otro código y el plan se crea igual", async () => {
    insertPlanFallos = ["dup"]; // el primer INSERT de la fila 1 choca; el reintento con el siguiente código sí entra
    const r = await confirmar([borrador()]);
    expect(r).toMatchObject({ ok: true });
    expect(vi.mocked(asegurarCodigoPlanUnicoTx)).toHaveBeenCalledTimes(2); // 1 inicial + 1 tras la colisión
    expect(creadosDestino()).toHaveLength(1);
  });
  it("8-9-14) error de INSERT que NO es duplicado -> se propaga, rollback TOTAL, nunca se interpreta como colisión de código", async () => {
    insertPlanFallos = ["otro"];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await confirmar([borrador(), borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3 })]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    if (!r.ok) expect(r.error).not.toContain("código de plan único"); // nunca se disfraza de colisión de código
    expect(creadosDestino()).toHaveLength(0); // ningún plan parcial
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    // solo 1 intento de código para la fila que falló: el error NO-duplicado no dispara un segundo intento de generación.
    expect(vi.mocked(asegurarCodigoPlanUnicoTx)).toHaveBeenCalledTimes(1);
  });
  // URGENTE — "tampoco funciona la copia masiva": el error SQL real quedaba oculto tras un mensaje genérico.
  it("URGENTE-A) guarda/trigger (SQLSTATE 45000) en la fila 2: rollback TOTAL y el error indica la FILA y el CÓDIGO SQL (nunca 'código de plan único')", async () => {
    insertPlanFallos = ["ok", "guarda"]; // la fila 1 se inserta; el INSERT de la fila 2 lo rechaza el trigger
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await confirmar([borrador(), borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3 })]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    if (!r.ok) {
      expect(r.error).toContain("Fila 2");
      expect(r.error).toContain("ER_SIGNAL_EXCEPTION");
      expect(r.error).not.toContain("código de plan único");
      expect(r.error).not.toContain("fusionado"); // el texto SQL no se devuelve al cliente
      expect(r.error).toContain("No se creó ningún viaje.");
    }
    expect(creadosDestino()).toHaveLength(0); // la fila 1 ya insertada se revierte
    expect(e.origen).toEqual([]);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(vi.mocked(asegurarCodigoPlanUnicoTx)).toHaveBeenCalledTimes(2); // 1 por fila: el error de la fila 2 NO regenera código
    // el detalle SQL completo queda en la bitácora del servidor, con la fila
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("fila 2"), expect.objectContaining({ code: "ER_SIGNAL_EXCEPTION", errno: 1644, sqlState: "45000", sqlMessage: "Seleccione la unidad principal: ID fusionado" }));
  });
  it("URGENTE-B) 5 colisiones REALES consecutivas del código -> agota con el mensaje de código (el único caso legítimo) y rollback total", async () => {
    insertPlanFallos = ["dup", "dup", "dup", "dup", "dup"];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await confirmar([borrador()]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    if (!r.ok) expect(r.error).toContain("código de plan único");
    expect(conn.execute.mock.calls.filter(([s]) => String(s).includes("INSERT INTO tms_planes_viaje"))).toHaveLength(5);
    expect(creadosDestino()).toHaveLength(0);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });
  it("URGENTE-C) si el generador (snapshot REPEATABLE READ) devuelve el MISMO código tras la colisión, igual avanza al siguiente número", async () => {
    vi.mocked(asegurarCodigoPlanUnicoTx).mockImplementation((async () => "PLAN-NUEVO-001") as never); // ciego a la fila ajena confirmada
    insertPlanFallos = ["dup"];
    const r = await confirmar([borrador()]);
    expect(r).toMatchObject({ ok: true, codigos: ["PLAN-NUEVO-002"] });
    expect(creadosDestino()).toHaveLength(1);
  });
  it("11) tms_plan_origen se crea para TODAS las filas del lote", async () => {
    const lote = [borrador({ fila: 1, origenPlanId: 900 }), borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 3 })];
    await confirmar(lote);
    expect(e.origen).toHaveLength(2);
    expect(e.origen.map((o) => o.plan_origen_id)).toEqual([900, 901]);
  });
  it("13) el confirm revalida bajo el candado: un recurso ocupado entre la preview y el confirm es un AVISO (copia fiel), pero un error real sí lo revierte todo", async () => {
    const ok = await validarLote(EMP, DESTINO, [borrador()]);
    expect(ok[0].estado).toBe("ok");
    e.planes.push(plan({ id: 50, codigo: "PLAN-EXISTENTE", piloto_id: 501 })); // otro usuario ocupa el recurso entre la preview y el confirm
    const r = await confirmar([borrador(), borrador({ fila: 2, origenPlanId: 901, rutaId: 13, unidadPlaca: null, pilotoEmpleadoId: 3 })]);   // la fila 2 tiene un error REAL (ruta inactiva)
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(creadosDestino()).toHaveLength(0);
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
    // datos de HISTORIA que NO deben copiarse al borrador (solo la tarifa del origen se LEE, para mostrarla en `origen.tarifaOriginal`)
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

  it("copia solo configuración: cliente, ruta, vehículo solicitado del origen, hora, traslado, tipo, unidad, TC, piloto, auxiliares (0..8) y paradas; tarifa NULL", async () => {
    const aux = Array.from({ length: 8 }, (_, i) => ({ plan_id: 900, orden: i + 1, id_empleado: 20 + i, nombre: `Aux ${i}` }));
    const [f] = await cargar([origenRow()], aux);
    expect(f.borrador).toEqual({
      fila: 1, origenPlanId: 900, vehiculoSolicitadoPerfilId: 11, rutaId: 10, clienteId: 3, horaCarga: "03:00", regresoOffsetDias: null, regresoHora: null, tipoTraslado: "Carga", tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: 31,
      pilotoEmpleadoId: 1, pilotoExtraEmpleadoId: null, auxiliarEmpleadoIds: [20, 21, 22, 23, 24, 25, 26, 27], tarifaId: null, externo: null,
      paradas: [{ lugarNombre: "Bodega", tipo: "Carga", requiereEvidencia: true }, { lugarNombre: "Xela", tipo: "Descarga", requiereEvidencia: true }],
    });
    // Nada de historia en el borrador (ni siquiera como campos ocultos)
    expect(JSON.stringify(f.borrador)).not.toMatch(/cerrado|km|VIEJA|999|estado|factura|evidencias|bitacora|gasto/i);
  });

  it("la tarifa del ORIGEN se lee SOLO para mostrarla (origen.tarifaOriginal): jamás entra al borrador ni a lo que se guarda", async () => {
    const [f] = await cargar([origenRow({ tarifa_id: 100, tarifa_comercial: "1234.50", tarifa_moneda_historico: "GTQ" })]);
    expect(f.origen.tarifaOriginal).toEqual({ monto: 1234.5, moneda: "GTQ" });
    expect(f.borrador.tarifaId).toBe(100);                                       // solo la REFERENCIA de catálogo, que se revalida como vigente
    expect(JSON.stringify(f.borrador)).not.toMatch(/1234|GTQ|tarifaOriginal/);
    const [sin] = await cargar([origenRow({ tarifa_id: null, tarifa_comercial: null, tarifa_moneda_historico: null })]);
    expect(sin.origen.tarifaOriginal).toEqual({ monto: null, moneda: null });     // el origen no tenía tarifa
    expect(sin.borrador.tarifaId).toBeNull();
    const sql = String(vi.mocked(query).mock.calls.find(([q]) => String(q).includes("LEFT JOIN tms_clientes c"))![0]);
    expect(sql).toContain("p.tarifa_comercial, p.tarifa_moneda_historico");      // solo lectura: se pide para mostrar
  });

  it("al CONFIRMAR, el cliente no puede enviar la tarifa/monto del origen: el esquema estricto lo rechaza y el destino usa el catálogo vigente", async () => {
    const { cuerpoCopiaSchema } = await import("./programacion-copia-schema");
    const { cuerpoLote } = await import("../../app/e/[slug]/programacion/copiar/copiar-helpers");
    const cuerpo = cuerpoLote(ORIGEN, DESTINO, [{ incluida: true, origen: { tarifaOriginal: { monto: 1, moneda: "GTQ" } } as never, advertencias: [], borrador: borrador(), validacion: null, sucia: false }]);
    expect(JSON.stringify(cuerpo)).not.toMatch(/tarifaOriginal|monto/);
    expect(cuerpoCopiaSchema.safeParse({ ...cuerpo, filas: [{ ...cuerpo.filas[0], tarifaOriginal: { monto: 1 } }] }).success).toBe(false);
    expect(cuerpoCopiaSchema.safeParse({ ...cuerpo, filas: [{ ...cuerpo.filas[0], tarifaComercial: 1 }] }).success).toBe(false);
  });

  it("origen histórico SIN vehículo solicitado: el borrador sale sin vehículo y con advertencia visible (la copia se bloqueará)", async () => {
    origenesSinVehiculo.add(900);
    const [f] = await cargar([origenRow()]);
    expect(f.borrador.vehiculoSolicitadoPerfilId).toBeNull();
    expect(f.advertencias.join(" ")).toMatch(/no tiene vehículo solicitado/);
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
        return origenes.filter((o) => o.empresa_id === emp && o.fecha === fecha && (!s.includes("estado <> 'Cancelado'") || o.estado !== "Cancelado") && ids.includes(o.id)).map((o) => ({ id: o.id, hora_carga: null, regreso_estimado: null }));
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
    expect(r[0].errores[0]).toBe("Juan Pérez está asignado también en la fila 2 de este mismo lote. Los horarios se solapan.");
  });

  it("3) cruce de medianoche dentro del lote: 22:00 -> 02:00 (+1 día) choca con una fila 23:00 y NO con una 01:00 -> 04:00 del mismo día", async () => {
    const noche = conVentana(1, "22:00", { dias: 1, hora: "02:00" }, mismoPiloto);
    expect(await estados([noche, conVentana(2, "23:00", { dias: 1, hora: "01:00" }, mismoPiloto)])).toEqual(["error", "error"]);
    expect(await estados([noche, conVentana(2, "01:00", { dias: 0, hora: "04:00" }, mismoPiloto)])).toEqual(["ok", "ok"]);
  });

  it("5) sin regreso: reserva TODO el día; ya NO bloquea (copia fiel): ambas filas pasan con aviso", async () => {
    const r = await validarLote(EMP, DESTINO, [conVentana(1, "05:00", null, mismoPiloto), conVentana(2, "20:00", { dias: 0, hora: "22:00" }, mismoPiloto)]);
    expect(r.map((x) => x.estado)).toEqual(["ok", "ok"]);
    expect(r[1].avisos?.[0]).toMatchObject({ tipo: "ventana_incompleta", filas: [1] });
    expect(r[0].diagnostico).toMatchObject({ regresoInvalido: true, filasAfectadas: [2] });   // el origen sigue identificado
  });

  it("66 filas con recursos repetidos: ventanas consecutivas sin avisos; con una sin regreso las 66 pasan CON avisos que señalan la fila", async () => {
    const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2,"0")}:${String(m % 60).padStart(2,"0")}`;
    const filas = Array.from({ length: 66 }, (_, i) => conVentana(i + 1, hora(i * 20), { dias: 0, hora: hora((i + 1) * 20) }, { pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [2], unidadPlaca: "P-1", tcVehiculoId: 31 }));
    expect((await validarLote(EMP, DESTINO, filas)).filter(r => r.estado === "ok")).toHaveLength(66);
    filas[32] = { ...filas[32], regresoHora: null, regresoOffsetDias: null };
    const conAvisos = await validarLote(EMP, DESTINO, filas);
    expect(conAvisos.filter(r => r.estado === "ok")).toHaveLength(66);
    expect(conAvisos.every((r) => (r.avisos?.length ?? 0) > 0)).toBe(true);
    const texto = conAvisos[0].avisos!.map((a) => a.mensaje).join(" ");
    expect(texto).toContain("fila 33");
    expect(texto).toContain("se reserva todo el día");
  });

  it("confirma un lote de 66 ventanas consecutivas y rechaza el reintento sin duplicar viajes", async () => {
    const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2,"0")}:${String(m % 60).padStart(2,"0")}`;
    const filas = Array.from({ length: 66 }, (_, i) => conVentana(i + 1, hora(i * 20), { dias: 0, hora: hora((i + 1) * 20) }, { pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [2], unidadPlaca: "P-1", tcVehiculoId: 31 }));
    const primera = await confirmar(filas);
    expect(primera.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(66);
    const segunda = await confirmar(filas);
    expect(segunda.ok).toBe(false);
    expect(creadosDestino()).toHaveLength(66);
  });

  it("6) sin hora de carga: reserva TODO el día aunque traiga regreso; ya no bloquea (aviso)", async () => {
    const r = await validarLote(EMP, DESTINO, [conVentana(1, null, { dias: 0, hora: "08:00" }, mismoPiloto), conVentana(2, "20:00", { dias: 0, hora: "22:00" }, mismoPiloto)]);
    expect(r.map((x) => x.estado)).toEqual(["ok", "ok"]);
    expect(r[1].avisos?.[0].mensaje).toContain("sin hora de carga");
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

  it("05:00-08:00 existente: la fila 08:00-11:00 pasa limpia y la 07:59-11:00 pasa con AVISO (piloto)", async () => {
    e.planes.push(existente());
    const limpio = await validarLote(EMP, DESTINO, [conVentana(1, "08:00", { dias: 0, hora: "11:00" }, { pilotoEmpleadoId: 1 })]);
    expect(limpio[0]).toMatchObject({ estado: "ok" }); expect(limpio[0].avisos).toBeUndefined();          // borde exacto: sin aviso
    const r = await validarLote(EMP, DESTINO, [conVentana(1, "07:59", { dias: 0, hora: "11:00" }, { pilotoEmpleadoId: 1 })]);
    expect(r[0]).toMatchObject({ estado: "ok", errores: [] });
    expect(r[0].avisos).toEqual([{ tipo: "destino_ocupado", recurso: { tipo: "piloto", id: "501" }, ocupadoPor: { planId: 50 }, mensaje: "El piloto Juan Pérez ya está asignado al PLAN-50 para el 25/09/2026. Se copia igual que el origen." }]);
  });

  it("cruce de medianoche contra BD: existente de ayer 22:00 -> hoy 02:00; fila 01:00 avisa, 02:00 no", async () => {
    e.planes.push(existente({ fecha: ORIGEN, hora: "22:00", regreso: `${DESTINO} 02:00:00` }));
    const choca = await validarLote(EMP, DESTINO, [conVentana(1, "01:00", { dias: 0, hora: "04:00" }, { pilotoEmpleadoId: 1 })]);
    expect(choca[0]).toMatchObject({ estado: "ok" }); expect(choca[0].avisos?.[0].tipo).toBe("destino_ocupado");
    const libre = await validarLote(EMP, DESTINO, [conVentana(1, "02:00", { dias: 0, hora: "05:00" }, { pilotoEmpleadoId: 1 })]);
    expect(libre[0].avisos).toBeUndefined();
  });

  it("existente SIN regreso (o sin hora) reserva todo su día: la fila avisa aunque sea de otra hora, y no toca el día siguiente", async () => {
    e.planes.push(existente({ regreso: null }));
    const mismoDia = await validarLote(EMP, DESTINO, [conVentana(1, "20:00", { dias: 0, hora: "22:00" }, { pilotoEmpleadoId: 1 })]);
    expect(mismoDia[0]).toMatchObject({ estado: "ok" }); expect(mismoDia[0].avisos?.[0].tipo).toBe("destino_ocupado");
    const diaSiguiente = await validarLote(EMP, "2026-09-26", [conVentana(1, "01:00", { dias: 0, hora: "03:00" }, { pilotoEmpleadoId: 1 })]);
    expect(diaSiguiente[0].avisos).toBeUndefined();
  });

  it("auxiliar, unidad y TC contra BD usan la misma comparación (07:59 avisa, 08:00 pasa limpia)", async () => {
    e.planes.push(existente({ piloto_id: null, aux: [502], unidad_id: 601, tc_vehiculo_id: 31 }));
    for (const recurso of [{ pilotoEmpleadoId: 3, auxiliarEmpleadoIds: [2] }, { unidadPlaca: "P-1" }, { tcVehiculoId: 31 }]) {
      const avisa = await validarLote(EMP, DESTINO, [conVentana(1, "07:59", { dias: 0, hora: "10:00" }, recurso)]);
      expect(avisa[0]).toMatchObject({ estado: "ok" }); expect(avisa[0].avisos?.[0].tipo).toBe("destino_ocupado");
      const limpia = await validarLote(EMP, DESTINO, [conVentana(1, "08:00", { dias: 0, hora: "10:00" }, recurso)]);
      expect(limpia[0].avisos).toBeUndefined();
    }
  });

  it("un plan Cancelado no genera aviso; uno Cerrado sigue reservando su ventana (aviso)", async () => {
    e.planes.push(existente({ estado: "Cancelado" }));
    expect((await validarLote(EMP, DESTINO, [conVentana(1, "06:00", { dias: 0, hora: "07:00" }, { pilotoEmpleadoId: 1 })]))[0].avisos).toBeUndefined();
    e.planes[e.planes.length - 1].estado = "Cerrado";
    expect((await validarLote(EMP, DESTINO, [conVentana(1, "06:00", { dias: 0, hora: "07:00" }, { pilotoEmpleadoId: 1 })]))[0].avisos?.[0].tipo).toBe("destino_ocupado");
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

  it("confirmar con un recurso ya ocupado en destino: se crean TODOS (aviso, copia fiel); un SOLAPE REAL dentro del lote sí lo revierte todo (todo o nada)", async () => {
    e.planes.push(existente());
    const fiel = await confirmarAceptando([conVentana(1, "10:00", { dias: 0, hora: "12:00" }, { pilotoEmpleadoId: 2 }), conVentana(2, "07:00", { dias: 0, hora: "09:00" }, { pilotoEmpleadoId: 1 })]);
    expect(fiel.ok).toBe(true);
    expect(e.planes.filter((p) => p.id >= 1000)).toHaveLength(2);
    e.planes = e.planes.filter((p) => p.id < 1000); e.origen = [];   // vuelve al estado inicial para el segundo escenario
    const real = await confirmar([conVentana(1, "05:00", { dias: 0, hora: "08:00" }, { pilotoEmpleadoId: 3 }), conVentana(2, "07:00", { dias: 0, hora: "09:00" }, { pilotoEmpleadoId: 3 })]);   // ambas ventanas conocidas y cruzadas
    expect(real.ok).toBe(false);
    expect(e.planes.filter((p) => p.id >= 1000)).toHaveLength(0);
  });
});

describe("A2.2 copiar: traslado del regreso estimado", () => {
  it("12) mismo día: 24/09 -> 24/09 17:30 copiado al 30/09 => 30/09 17:30", () => {
    const t = calcularTrasladoRegreso("2026-09-24", "08:00", "2026-09-24 17:30:00");
    expect(t).toEqual({ offsetDias: 0, hora: "17:30" });
    expect(regresoTrasladado("2026-09-30", t)).toBe("2026-09-30T17:30");
  });

  it("13) +1 día: 24/09 22:00 -> 25/09 02:00 copiado al 30/09 => 01/10 02:00 (NO 25/09)", () => {
    const t = calcularTrasladoRegreso("2026-09-24", "22:00", "2026-09-25 02:00:00");
    expect(t).toEqual({ offsetDias: 1, hora: "02:00" });
    expect(regresoTrasladado("2026-09-30", t)).toBe("2026-10-01T02:00");
  });

  it("14) +2 días: 24/09 -> 26/09 05:00 copiado al 30/09 => 02/10 05:00", () => {
    const t = calcularTrasladoRegreso("2026-09-24", "08:00", "2026-09-26T05:00");
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
    expect(calcularTrasladoRegreso("2026-09-24", "08:00", null)).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "08:00", "")).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "08:00", "2026-09-23 10:00:00")).toBeNull(); // antes de la fecha de salida
    expect(calcularTrasladoRegreso("2026-09-24", "08:00", "basura")).toBeNull();
    expect(regresoTrasladado("2026-09-30", null)).toBeNull();
  });

  const origenRow = (regreso: string | null) => ({
    id: 900, codigo: "PLAN-20260924-001", estado: "Programado", cliente_id: 3, cliente_nombre: "Acme", ruta_id: 10, ruta_codigo_historico: "1001", hora_carga: "22:00:00", regreso_estimado: regreso, tipo_traslado: "Carga", tarifa_id: 101,
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
    expect(con.borrador.tarifaId).toBe(101);
    const [sin] = await cargarOrigen(null);
    expect(sin.borrador).toMatchObject({ regresoOffsetDias: null, regresoHora: null });
    expect(String(vi.mocked(query).mock.calls.find(([s]) => String(s).includes("LEFT JOIN tms_clientes c"))![0])).toContain("DATE_FORMAT(p.regreso_estimado");
  });

  it("borradoresDesdeCliente recalcula el traslado desde el origen y IGNORA lo que mande el cliente", async () => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      if (String(sql).includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && String(sql).includes("DATE_FORMAT(regreso_estimado")) return [{ id: 900, hora_carga: "03:00:00", regreso_estimado: "2026-09-26 05:00:00" }];
      return base(sql, params);
    }) as never);
    const falso = { ...borrador({ origenPlanId: 900 }), regresoOffsetDias: 9, regresoHora: "23:59" } as never;
    const r = await borradoresDesdeCliente(EMP, ORIGEN, [falso]);
    expect(r.ok && r.borradores[0]).toMatchObject({ regresoOffsetDias: 2, regresoHora: "05:00" });
  });

  it("admite un regreso editado válido y rechaza fechas inválidas o anteriores a la carga", async () => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      if (String(sql).includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && String(sql).includes("DATE_FORMAT(regreso_estimado")) return [{ id: 900, hora_carga: "03:00:00", regreso_estimado: null }];
      return base(sql, params);
    }) as never);
    const fila = borrador({ origenPlanId: 900, horaCarga: "08:00", regresoEditado: `${DESTINO}T12:00` });
    const valida = await borradoresDesdeCliente(EMP, ORIGEN, [fila], DESTINO);
    expect(valida.ok && valida.borradores[0]).toMatchObject({ regresoOffsetDias: 0, regresoHora: "12:00" });
    const invalida = await borradoresDesdeCliente(EMP, ORIGEN, [{ ...fila, regresoEditado: `${DESTINO}T07:59` }], DESTINO);
    expect(invalida).toMatchObject({ ok: false, error: expect.stringContaining("Fila 1") });
    const imposible = await borradoresDesdeCliente(EMP, ORIGEN, [{ ...fila, regresoEditado: "2026-02-30T12:00" }], DESTINO);
    expect(imposible).toMatchObject({ ok: false, error: expect.stringContaining("Fila 1") });
    const borrada = await borradoresDesdeCliente(EMP, ORIGEN, [{ ...fila, regresoEditado: null }], DESTINO);
    expect(borrada.ok && borrada.borradores[0]).toMatchObject({ regresoOffsetDias: null, regresoHora: null });
  });

  it("el cuerpo que arma la pantalla de Copiar no envía los campos de traslado (el esquema estricto los rechazaría)", async () => {
    const { cuerpoLote } = await import("../../app/e/[slug]/programacion/copiar/copiar-helpers");
    const cuerpo = cuerpoLote(ORIGEN, DESTINO, [{ incluida: true, origen: {} as never, advertencias: [], borrador: { ...borrador(), regresoOffsetDias: 1, regresoHora: "02:00" }, validacion: null, sucia: false }]);
    const claves = Object.keys(cuerpo.filas[0]);
    expect(claves).not.toContain("regresoOffsetDias");
    expect(claves).not.toContain("regresoHora");
    expect(claves).not.toContain("paradas");
  });

  it("envía una edición explícita del regreso sin aceptar los campos calculados", async () => {
    const { cuerpoLote } = await import("../../app/e/[slug]/programacion/copiar/copiar-helpers");
    const { cuerpoCopiaSchema } = await import("./programacion-copia-schema");
    const cuerpo = cuerpoLote(ORIGEN, DESTINO, [{ incluida: true, origen: {} as never, advertencias: [], borrador: { ...borrador(), regresoEditado: `${DESTINO}T12:00` }, validacion: null, sucia: false }]);
    expect(cuerpo.filas[0].regresoEditado).toBe(`${DESTINO}T12:00`);
    expect(cuerpoCopiaSchema.safeParse(cuerpo).success).toBe(true);
    expect(cuerpoCopiaSchema.safeParse({ ...cuerpo, filas: [{ ...cuerpo.filas[0], regresoOffsetDias: 1 }] }).success).toBe(false);
  });
});

// ------------------------------------------------------------------ A2.2 corrección: el traslado se valida contra la hora de carga
import { regresoPersistidoDeBorrador, ventanaDeBorrador } from "./programacion-lote";

describe("A2.2 traslado del regreso validado contra la hora de carga del origen", () => {
  it("1) mismo día con regreso POSTERIOR a la salida: conserva +0 y la hora (05:00 -> 08:00)", () => {
    expect(calcularTrasladoRegreso("2026-09-24", "05:00", "2026-09-24 08:00:00")).toEqual({ offsetDias: 0, hora: "08:00" });
    expect(regresoTrasladado("2026-09-30", calcularTrasladoRegreso("2026-09-24", "05:00:00", "2026-09-24 08:00:00"))).toBe("2026-09-30T08:00");
  });

  it("2) mismo día con regreso ANTERIOR a la salida (22:00 -> 02:00 del mismo día): null", () => {
    expect(calcularTrasladoRegreso("2026-09-24", "22:00", "2026-09-24 02:00:00")).toBeNull();
  });

  it("3) regreso IGUAL a la salida: null (también 1 minuto antes; 1 minuto después se conserva)", () => {
    expect(calcularTrasladoRegreso("2026-09-24", "05:00", "2026-09-24 05:00:00")).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "05:00", "2026-09-24 04:59:00")).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "05:00", "2026-09-24 05:01:00")).toEqual({ offsetDias: 0, hora: "05:01" });
  });

  it("4) cruce de medianoche válido: 22:00 -> 25/09 02:00 = +1 día, 02:00", () => {
    expect(calcularTrasladoRegreso("2026-09-24", "22:00", "2026-09-25 02:00:00")).toEqual({ offsetDias: 1, hora: "02:00" });
  });

  it("5) +2 días: 22:00 -> 26/09 05:00 => +2, 05:00 (aunque la hora del regreso sea menor que la de carga)", () => {
    expect(calcularTrasladoRegreso("2026-09-24", "22:00", "2026-09-26 05:00:00")).toEqual({ offsetDias: 2, hora: "05:00" });
  });

  it("hora de carga inválida o regreso inválido: null; sin hora de carga se compara contra el inicio del día", () => {
    expect(calcularTrasladoRegreso("2026-09-24", "25:00", "2026-09-24 08:00:00")).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "abc", "2026-09-24 08:00:00")).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", null, "2026-09-24 08:00:00")).toEqual({ offsetDias: 0, hora: "08:00" });
    expect(calcularTrasladoRegreso("2026-09-24", null, "2026-09-24 00:00:00")).toBeNull();
    expect(calcularTrasladoRegreso("2026-09-24", "05:00", "2026-13-40 08:00:00")).toBeNull();
  });

  const origenRow = (hora: string | null, regreso: string | null) => ({
    id: 900, codigo: "PLAN-20260924-001", estado: "Programado", cliente_id: 3, cliente_nombre: "Acme", ruta_id: 10, ruta_codigo_historico: "1001", hora_carga: hora, regreso_estimado: regreso, tipo_traslado: "Carga",
    tipo_viaje: "Propio", unidad_placa: "P-1", tc_vehiculo_id: null, tc_placa_historica: null, tc_externo_placa: null, piloto_empleado_id: 1, piloto_nombre: "Juan Pérez",
    aux1_empleado_id: null, aux1_nombre: null, piloto_externo_nombre: null, auxiliares_externos: null, unidad_externa_placa: null, unidad_externa_descripcion: null, transportista_externo: null, costo_tercerizado: null,
  });
  const cargar = async (hora: string | null, regreso: string | null) => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      const s = String(sql);
      if (s.includes("LEFT JOIN tms_clientes c") && s.includes("p.fecha_plan = ?")) return [origenRow(hora, regreso)];
      if (s.includes("FROM tms_plan_auxiliares pa")) return [];
      return base(sql, params);
    }) as never);
    return cargarCopiaDeFecha(EMP, ORIGEN);
  };

  it("cargarCopiaDeFecha pasa la hora de carga del origen: 22:00 con regreso 02:00 del MISMO día => sin traslado", async () => {
    const [incoherente] = await cargar("22:00:00", "2026-09-24 02:00:00");
    expect(incoherente.borrador).toMatchObject({ horaCarga: "22:00", regresoOffsetDias: null, regresoHora: null });
    const [valido] = await cargar("22:00:00", "2026-09-25 02:00:00");
    expect(valido.borrador).toMatchObject({ regresoOffsetDias: 1, regresoHora: "02:00" });
  });

  it("6) confirmar un origen incoherente persiste regreso_estimado NULL (la validación usó reserva diaria)", async () => {
    const [f] = await cargar("22:00:00", "2026-09-24 02:00:00");
    const b = { ...f.borrador, fila: 1, unidadPlaca: null, pilotoEmpleadoId: 2 };
    expect(ventanaDeBorrador(b, "2026-09-30")).toEqual({ fechaPlan: "2026-09-30", horaCarga: "22:00", regresoEstimado: null });
    expect((await confirmar([b], "2026-09-30")).ok).toBe(true);
    const creado = e.planes.find((p) => p.id >= 1000)!;
    expect([creado.fecha, creado.hora, creado.regreso]).toEqual(["2026-09-30", "22:00", null]);
  });

  it("borradoresDesdeCliente relee hora_carga Y regreso del ORIGEN: un origen incoherente no se traslada aunque el cliente lo mande", async () => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      if (String(sql).includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && String(sql).includes("hora_carga, DATE_FORMAT(regreso_estimado")) return [{ id: 900, hora_carga: "22:00:00", regreso_estimado: "2026-09-24 02:00:00" }];
      return base(sql, params);
    }) as never);
    const falso = { ...borrador({ origenPlanId: 900, horaCarga: "22:00" }), regresoOffsetDias: 0, regresoHora: "02:00" } as never;
    const r = await borradoresDesdeCliente(EMP, ORIGEN, [falso]);
    expect(r.ok && r.borradores[0]).toMatchObject({ regresoOffsetDias: null, regresoHora: null });
  });

  it("7) la ventana validada y el valor persistido coinciden SIEMPRE (incluida una hora editada en la vista previa)", async () => {
    const casos: [string, BorradorLote][] = [
      ["regreso posterior", conVentana(1, "05:00", { dias: 0, hora: "08:00" })],
      ["cruce de medianoche", conVentana(1, "22:00", { dias: 1, hora: "02:00" })],
      ["sin regreso", conVentana(1, "05:00", null)],
      ["hora editada DESPUÉS del regreso derivado (09:00 > 08:00)", conVentana(1, "09:00", { dias: 0, hora: "08:00" })],
      ["hora editada igual al regreso", conVentana(1, "08:00", { dias: 0, hora: "08:00" })],
    ];
    for (const [nombre, b] of casos) {
      const validada = ventanaDeBorrador(b, "2026-09-30").regresoEstimado;
      expect(regresoPersistidoDeBorrador(b, "2026-09-30"), nombre).toBe(validada);
      e.planes = [];
      e.origen = []; // el anti-duplicado (origen + destino) no debe ver la confirmación del caso anterior
      expect((await confirmar([b], "2026-09-30")).ok, nombre).toBe(true);
      const guardado = e.planes.find((p) => p.id >= 1000)!.regreso ?? null;
      expect(guardado, nombre).toBe(validada ? validada.replace("T", " ") : null);
    }
  });
});

// ------------------------------------------------------------------ PR #355: copiar SIN tarifa
import { filaDesdeCarga, puedeConfirmar, resumenFilas, alternarSeleccion, aplicarValidacion } from "../../app/e/[slug]/programacion/copiar/copiar-helpers";

describe("Copiar: la ausencia de tarifa NO bloquea", () => {
  const insertPlan = () => conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje")) as unknown as [string, unknown[]][];
  const sinTarifa = (over: Partial<BorradorLote> = {}) => borrador({ rutaId: 12, ...over }); // ruta 12: sin tarifa vigente

  it("1) una fila CON tarifa sigue copiando su tarifa vigente/predeterminada", async () => {
    expect((await confirmar([borrador()])).ok).toBe(true);
    expect(creadosDestino()[0]).toMatchObject({ tarifa_comercial: 1500, tarifa_id: 100, tarifa_nombre: "Base" });
  });

  it("2/8) una fila SIN tarifa es válida: sin errores, estado ok y tarifa null (advertencia solo visual)", async () => {
    const [r] = await validarLote(EMP, DESTINO, [sinTarifa()]);
    expect(r).toMatchObject({ fila: 1, estado: "ok", errores: [], tarifa: null });
  });

  it("2) en la pantalla de Copiar la fila sin tarifa es seleccionable y CUENTA para Confirmar copia (X viajes)", () => {
    const f = filaDesdeCarga({ origen: {} as never, advertencias: [], borrador: sinTarifa(), validacion: null });
    let filas = alternarSeleccion([f], 0);
    filas = aplicarValidacion(filas, [{ fila: 1, estado: "ok", errores: [], tarifa: null }]);
    expect(resumenFilas(filas).incluidas).toBe(1);
    expect(puedeConfirmar(filas, false)).toBe(true);
  });

  it("3/4/5/6) confirmar copia sin tarifa: el viaje destino queda con tarifa_id, snapshots y tarifa_comercial en NULL (no 0)", async () => {
    const r = await confirmar([sinTarifa()]);
    expect(r.ok).toBe(true);
    expect(creadosDestino()[0]).toMatchObject({ tarifa_comercial: null, tarifa_id: null, tarifa_nombre: null });
    const p = insertPlan()[0][1];
    expect(p.slice(12, 17)).toEqual([null, null, null, null, null]); // comercial, id, nombre, monto, moneda
    expect(p.slice(12, 17)).not.toContain(0);
  });

  it("7) lote mixto: A con tarifa y B sin tarifa copian ambos, cada uno con lo suyo", async () => {
    const r = await confirmar([borrador({ fila: 1, origenPlanId: 900 }), sinTarifa({ fila: 2, origenPlanId: 901, pilotoEmpleadoId: 2, unidadPlaca: "P-2" })]);
    expect(r.ok).toBe(true);
    const [a, b] = creadosDestino();
    expect([a.tarifa_id, a.tarifa_comercial]).toEqual([100, 1500]);
    expect([b.tarifa_id, b.tarifa_comercial]).toEqual([null, null]);
  });

  it("9) NO inventa tarifa: elegir una tarifa (de otra ruta) para una ruta sin tarifa es error explícito; sin elegir nada queda sin tarifa", async () => {
    const [explicita] = await validarLote(EMP, DESTINO, [sinTarifa({ tarifaId: 100 })]); // 100 es de la ruta 10
    expect(explicita).toMatchObject({ estado: "error", errores: ["La tarifa seleccionada no es una tarifa vigente de esta ruta."] });
    const [implicita] = await validarLote(EMP, DESTINO, [sinTarifa()]);
    expect(implicita.tarifa).toBeNull();
    await confirmar([sinTarifa()]);
    expect(creadosDestino()[0].tarifa_id).not.toBe(100);
  });

  it("10) no altera fecha, hora, regreso trasladado ni recursos de la copia", async () => {
    const b = sinTarifa({ horaCarga: "22:00", regresoOffsetDias: 1, regresoHora: "02:00", unidadPlaca: "P-1", pilotoEmpleadoId: 1 });
    await confirmar([b], "2026-09-30");
    const c = e.planes.find((x) => x.id >= 1000)!;
    expect([c.fecha, c.hora, c.regreso, c.unidad_id, c.piloto_id]).toEqual(["2026-09-30", "22:00", "2026-10-01 02:00", 601, 501]);
  });

  it("la pantalla de Copiar muestra 'Sin tarifa' como aviso NO bloqueante y no filtra filas por tarifa", () => {
    const page = readFileSync("src/app/e/[slug]/programacion/copiar/page.tsx", "utf8");
    expect(page).toContain("Sin tarifa — podrás asignarla después");
    expect(page).not.toMatch(/no tiene una tarifa vigente/);
    const helpers = readFileSync("src/app/e/[slug]/programacion/copiar/copiar-helpers.ts", "utf8");
    expect(helpers).not.toMatch(/tarifa\s*(===|==|!==)\s*null/); // ninguna regla de selección/confirmación mira la tarifa
  });
});

// ------------------------------------------------------------------ PILOTO EXTRA: copiar programación
describe("piloto extra al copiar programación (máximo 1; misma disponibilidad que el principal)", () => {
  const conExtra = (fila = 1, origen = 900) => borrador({ fila, origenPlanId: origen, pilotoEmpleadoId: 1, pilotoExtraEmpleadoId: 6 });
  const extras = () => conn.execute.mock.calls.filter((c) => String(c[0]).includes("tms_plan_pilotos_adicionales"));

  it("18) copiar un viaje conserva el piloto extra: lo guarda en la MISMA transacción y le crea su viático (sync con pilotoExtra), sin copiar montos", async () => {
    const r = await confirmar([conExtra()]);
    expect(r.ok).toBe(true);
    const creado = creadosDestino()[0];
    expect(creado.extra).toBe(700); // tms_personal materializado del empleado 6 (rol Piloto)
    expect(extras().map((c) => String(c[0]).split(" ")[0])).toEqual(["DELETE", "INSERT"]);
    expect(vi.mocked(personalDesdeEmpleado)).toHaveBeenCalledWith(EMP, 6, "Piloto", conn);
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toMatchObject({ piloto: 501, pilotoExtra: 700 });
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("sin extra en el origen: idéntico a antes (no escribe la tabla nueva; sync con pilotoExtra null)", async () => {
    await confirmar([borrador()]);
    expect(extras()).toHaveLength(0);
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toMatchObject({ pilotoExtra: null });
  });

  it("el extra pasa por la MISMA comprobación de disponibilidad: ocupado el mismo día en otro viaje → AVISO que nombra al extra y la copia se crea con su extra", async () => {
    e.personal.push({ id: 702, id_empleado: 6, nombre: "Extra Piloto" });
    e.planes.push(plan({ id: 50, codigo: "PLAN-EXISTENTE", piloto_id: 502, extra: 702, unidad_id: 602, hora: "03:00", regreso: `${DESTINO} 06:00:00` }));
    const previa = await validarLote(EMP, DESTINO, [conExtra()]);
    expect(previa[0]).toMatchObject({ estado: "ok" });
    expect(JSON.stringify(previa[0].avisos)).toContain("Extra Piloto");
    const r = await confirmarAceptando([conExtra()]);
    expect(r.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(1);
    expect(extras()).toHaveLength(2);   // el viaje existente (con su extra) + el nuevo con su extra copiado
  });

  it("colisión DENTRO del lote: el extra de una fila y el principal de otra (sin regreso) → ambas pasan con aviso que señala la otra fila", async () => {
    const res = await validarLote(EMP, DESTINO, [conExtra(1, 900), borrador({ fila: 2, origenPlanId: 901, unidadPlaca: "P-2", pilotoEmpleadoId: 6 })]);
    expect(res.every((f) => f.estado === "ok")).toBe(true);
    expect((res[0].avisos ?? []).map((a) => a.mensaje).join(" ")).toContain("también en la fila 2");
  });

  it("4/5/6) el extra no puede repetir al principal ni a un auxiliar", async () => {
    const [a] = await validarLote(EMP, DESTINO, [borrador({ pilotoEmpleadoId: 1, pilotoExtraEmpleadoId: 1 })]);
    expect(a.errores.join(" ")).toContain("no pueden repetirse");
    const [b] = await validarLote(EMP, DESTINO, [borrador({ pilotoExtraEmpleadoId: 6, auxiliarEmpleadoIds: [6] })]);
    expect(b.errores.join(" ")).toContain("no pueden repetirse");
  });

  it("solo RRHH activo con puesto de piloto: un auxiliar/inactivo/inexistente no puede ser extra", async () => {
    expect((await validarLote(EMP, DESTINO, [borrador({ pilotoExtraEmpleadoId: 8 })]))[0].errores.join(" ")).toContain("no tiene puesto de piloto");
    expect((await validarLote(EMP, DESTINO, [borrador({ pilotoExtraEmpleadoId: 5 })]))[0].errores.join(" ")).toContain("inactivo");
    expect((await validarLote(EMP, DESTINO, [borrador({ pilotoExtraEmpleadoId: 999 })]))[0].errores.join(" ")).toContain("piloto extra seleccionado no existe");
  });

  it("19) un viaje Tercerizado no admite piloto extra interno", async () => {
    const externo = { pilotoExternoNombre: "Ext", auxiliaresExternos: [], unidadExternaPlaca: "", unidadExternaDescripcion: "", transportistaExterno: "", costoTercerizado: null, tcExternoPlaca: "" };
    const [r] = await validarLote(EMP, DESTINO, [borrador({ tipoViaje: "Tercerizado", unidadPlaca: null, pilotoEmpleadoId: null, pilotoExtraEmpleadoId: 6, externo })]);
    expect(r.errores.join(" ")).toContain("piloto extra");
  });

  it("todo o nada: si falla después de guardar el extra (viáticos) se revierte el plan Y el extra", async () => {
    falla = { en: "viaticos", enPlanNumero: 1 };
    const r = await confirmar([conExtra()]);
    expect(r.ok).toBe(false);
    expect(creadosDestino()).toHaveLength(0);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("copiar: el borrador toma el extra del viaje origen en UNA consulta para todos los planes (sin N+1) y avisa si no está vinculado a un empleado", async () => {
    const base = vi.mocked(query).getMockImplementation() as unknown as (s: string, p: unknown[]) => Promise<unknown>;
    let consultasExtra = 0;
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      const s = String(sql);
      if (s.includes("LEFT JOIN tms_clientes c") && s.includes("p.fecha_plan = ?")) {
        return [900, 901].map((id) => ({ id, codigo: `P${id}`, estado: "Programado", cliente_id: 3, cliente_nombre: "Acme", ruta_id: 10, ruta_codigo_historico: "1001", hora_carga: "03:00:00", regreso_estimado: null,
          tipo_traslado: "Carga", tipo_viaje: "Propio", unidad_placa: "P-1", tc_vehiculo_id: null, tc_placa_historica: null, tc_externo_placa: null, piloto_empleado_id: 1, piloto_nombre: "Juan Pérez",
          aux1_empleado_id: null, aux1_nombre: null, piloto_externo_nombre: null, auxiliares_externos: null, unidad_externa_placa: null, unidad_externa_descripcion: null, transportista_externo: null, costo_tercerizado: null }));
      }
      if (s.includes("FROM tms_plan_pilotos_adicionales x")) { consultasExtra++; return [{ plan_id: 900, id_empleado: 6, nombre: "Extra Piloto" }, { plan_id: 901, id_empleado: null, nombre: "Sin vínculo" }]; }
      if (s.includes("FROM tms_plan_auxiliares pa")) return [];
      return base(sql, params);
    }) as never);
    const filas = await cargarCopiaDeFecha(EMP, ORIGEN);
    expect(consultasExtra).toBe(1);
    expect(filas[0].borrador.pilotoExtraEmpleadoId).toBe(6);
    expect(filas[0].origen.pilotoExtraNombre).toBe("Extra Piloto");
    expect(filas[1].borrador.pilotoExtraEmpleadoId).toBeNull();
    expect(filas[1].advertencias.join(" ")).toContain("piloto extra");
  });

  it("el esquema del cliente acepta el extra (opcional) y sigue siendo estricto; el servidor lo revalida", () => {
    const src = readFileSync("src/lib/tms/programacion-copia-schema.ts", "utf8");
    expect(src).toContain("pilotoExtraEmpleadoId: idNullable.optional()");
    expect(src).toContain(".strict()");
  });
});

describe("copia: identidad de unidad TMS con el resolvedor REAL de #624 (viajes con referencias anteriores a la canonicalización)", () => {
  const flotaP1 = { id: 1, empresa_id: EMP, placa: "P-1", activo: 1, estado: "Activo" };
  const lecturas = () => conn.query.mock.calls.map((c) => String(c[0])).filter((q) => !/^\s*SET\s+SESSION\b/i.test(q));   // sentencias de datos de la vista previa (sin los SET de sesión del lector)
  const conModelo = (unidades: { id: number; placa: string; flota_vehiculo_id: number | null }[]) => {
    const m = modeloSqlUnidadTms(EMP, [flotaP1, { ...flotaP1, id: 2, placa: "P-2" }]); for (const u of unidades) m.modelo.unidades.push({ ...u, empresa_id: EMP }); unidadReal.modelo = m as never;
    e.unidades = m.modelo.unidades.map((u) => ({ id: u.id, placa: u.placa }));   // el motor y el modelo SQL ven las MISMAS unidades TMS
    conn.query.mockClear();   // la vista previa lee por una conexión dedicada (getConnection): sus sentencias quedan en conn.query
    return m;
  };
  it("VISTA PREVIA: la unidad histórica sin vínculo a Flota se marca con error en SU fila (antes la preview decía «ok» y fallaba todo al confirmar); la otra fila queda ok; no se escribe nada y solo se ejecutan SELECT", async () => {
    const m = conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: null }]);
    const r = await validarLote(EMP, DESTINO, [borrador({ fila: 1, unidadPlaca: "P-2", origenPlanId: 901, pilotoEmpleadoId: 2 }), borrador({ fila: 2, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 })]);
    expect(r.map((x) => x.estado)).toEqual(["ok", "error"]); expect(r[1].errores).toEqual(["Unidad P-1: Conflicto de identidad TMS: revisar los vínculos existentes; no se reescriben planes históricos."]);
    expect(m.modelo.unidades).toEqual([{ id: 601, empresa_id: EMP, placa: "P-1", flota_vehiculo_id: null }]); expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(lecturas().length).toBeGreaterThan(0); expect(lecturas().every((q) => /^\s*SELECT\b/i.test(q) && !/FOR\s+UPDATE/i.test(q))).toBe(true);   // solo SELECT y NINGUNO con FOR UPDATE
  });
  it("34 filas sintéticas: una identidad en conflicto bloquea solo su fila", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: null }]);
    const filas = Array.from({ length: 34 }, (_, i) => borrador({ fila: i + 1, origenPlanId: 900 + i, unidadPlaca: i === 33 ? "P-1" : null, pilotoEmpleadoId: null, auxiliarEmpleadoIds: [] }));
    const resultado = await validarLote(EMP, DESTINO, filas);
    expect(resultado.filter(r => r.estado === "ok")).toHaveLength(33);
    expect(resultado[33].errores.join(" ")).toContain("Conflicto de identidad TMS");
  });
  it("VISTA PREVIA: sin unidad TMS previa (se crearía al confirmar) no se consulta nada ni se inserta; unidad ya vinculada a la misma de Flota → ok", async () => {
    conModelo([]); const sinUnidad = await validarLote(EMP, DESTINO, [borrador({ unidadPlaca: "P-9" })]); expect(sinUnidad[0].estado).toBe("error");   // P-9 no existe en Flota: la validación de siempre
    conn.query.mockClear(); const nueva = await validarLote(EMP, DESTINO, [borrador({ unidadPlaca: "P-2" })]); expect(nueva[0].estado).toBe("ok"); expect(lecturas().filter((q) => /tms_unidades|flota_vehiculos|empresas/i.test(q))).toEqual([]);   // P-2 sin fila TMS: el resolvedor no se invoca
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }]); expect((await validarLote(EMP, DESTINO, [borrador({ unidadPlaca: "P-1" })]))[0].estado).toBe("ok");
  });
  it("VISTA PREVIA — varias unidades: las consultas de metadatos y listas por empresa se hacen UNA vez para todo el lote (no por unidad) y la lectura no usa FOR UPDATE", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }, { id: 602, placa: "P-2", flota_vehiculo_id: 2 }]);
    const r = await validarLote(EMP, DESTINO, [borrador({ fila: 1, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 }), borrador({ fila: 2, unidadPlaca: "P-2", origenPlanId: 901, pilotoEmpleadoId: 2 })]);
    expect(r.map((x) => x.estado)).toEqual(["ok", "ok"]);
    const q = lecturas();
    expect(q.filter((x) => /FROM tms_unidades/i.test(x))).toHaveLength(1);
    expect(q.filter((x) => /FROM empresas/i.test(x))).toHaveLength(1);
    expect(q.filter((x) => /information_schema/i.test(x)).length).toBeLessThanOrEqual(3);   // metadatos: tablas/fusiones/identidad, una vez cada uno
    expect(q.some((x) => /FOR\s+UPDATE/i.test(x))).toBe(false);
  });
  it("VISTA PREVIA — fallo TÉCNICO (ER_LOCK_WAIT_TIMEOUT): no se oculta, sube como ErrorVistaPrevia con mensaje controlado, se detiene en la PRIMERA unidad (sin esperas acumuladas) y no escribe nada", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }, { id: 602, placa: "P-2", flota_vehiculo_id: 2 }]);
    const base = conn.query.getMockImplementation()!; let intentos = 0;
    conn.query.mockImplementation((async (sql: string, a?: unknown[]) => { if (/FROM tms_unidades/i.test(String(sql))) { intentos++; throw Object.assign(new Error("Lock wait timeout exceeded on `tms_unidades` (host interno)"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }); } return base(sql, a); }) as never);
    const err = await validarLote(EMP, DESTINO, [borrador({ fila: 1, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 }), borrador({ fila: 2, unidadPlaca: "P-2", origenPlanId: 901, pilotoEmpleadoId: 2 })]).then(() => null, (x: unknown) => x);
    expect(err).toBeInstanceOf(ErrorVistaPrevia);
    expect((err as ErrorVistaPrevia).message).toContain("ER_LOCK_WAIT_TIMEOUT");
    expect((err as ErrorVistaPrevia).message).not.toMatch(/tms_unidades|host interno/);
    expect(intentos).toBe(1);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(vi.mocked(console.error)).toHaveBeenCalledWith("resolverYValidar: verificación de identidad de unidades no completada", { codigo: "ER_LOCK_WAIT_TIMEOUT" });   // sin placas ni datos de la empresa
  });
  it("VISTA PREVIA — la conexión dedicada nunca queda sin liberar: error SQL normal → vuelve al pool; error de estado incierto → se DESTRUYE (nunca vuelve al pool)", async () => {
    for (const [err, esperado] of [
      [Object.assign(new Error("x"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }), "release"],
      [new Error("socket hang up"), "destroy"],
    ] as const) {
      conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }]);
      const base = conn.query.getMockImplementation()!;
      conn.query.mockImplementation((async (sql: string, a?: unknown[]) => { if (/FROM tms_unidades/i.test(String(sql))) throw err; return base(sql, a); }) as never);
      conn.release.mockClear(); conn.destroy.mockClear();
      await validarLote(EMP, DESTINO, [borrador({ unidadPlaca: "P-1" })]).catch(() => undefined);
      const otro = esperado === "release" ? "destroy" : "release";
      expect(conn[esperado]).toHaveBeenCalledTimes(1);
      expect(conn[otro]).not.toHaveBeenCalled();
    }
  });
  it("CONFIRMAR — la verificación previa NO es fatal ante un fallo técnico: la transacción real es la autoridad; si ella también falla, rollback total y nada creado", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }]);
    const base = conn.query.getMockImplementation()!;
    conn.query.mockImplementation((async (sql: string, a?: unknown[]) => { if (/FROM tms_unidades/i.test(String(sql))) throw Object.assign(new Error("x"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }); return base(sql, a); }) as never);
    const r = await confirmar([borrador({ fila: 1, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 })]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(creadosDestino()).toHaveLength(0); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.rollback).toHaveBeenCalled();
  });
  it("CONFIRMAR — el resolvedor de la TRANSACCIÓN sigue tomando FOR UPDATE (la autoridad conserva sus bloqueos)", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }]);
    const r = await confirmar([borrador({ fila: 1, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 })]);
    expect(r).toMatchObject({ ok: true });
    expect(lecturas().some((x) => /FROM tms_unidades.*FOR UPDATE/i.test(x))).toBe(true);
  });
  it("CONFIRMAR con la unidad histórica en conflicto: la revalidación bajo candado lo rechaza ANTES de abrir transacción (409, errores por fila), nada se crea", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: null }]);
    const r = await confirmar([borrador({ fila: 1, unidadPlaca: "P-2", origenPlanId: 901, pilotoEmpleadoId: 2 }), borrador({ fila: 2, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 })]);
    expect(r).toMatchObject({ ok: false, status: 409 }); if (r.ok) return;
    expect(r.erroresPorFila).toEqual([{ fila: 2, errores: ["Unidad P-1: Conflicto de identidad TMS: revisar los vínculos existentes; no se reescriben planes históricos."] }]);
    expect(creadosDestino()).toHaveLength(0); expect(conn.beginTransaction).not.toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
  });
  it("REGRESIÓN (defensa en profundidad): si el conflicto aparece DESPUÉS de la revalidación (otro usuario vinculó/creó la unidad entre medias), el lote no crea nada y el error dice FILA, PLACA y MOTIVO REAL con 409; se revierte todo", async () => {
    const m = conModelo([]);
    conn.beginTransaction.mockImplementation(async () => { respaldo = JSON.stringify(e); m.modelo.unidades.push({ id: 601, empresa_id: EMP, placa: "P-1", flota_vehiculo_id: null }); });   // aparece al abrir la transacción del lote
    const r = await confirmar([borrador({ fila: 1, unidadPlaca: "P-2", origenPlanId: 901, pilotoEmpleadoId: 2 }), borrador({ fila: 2, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 })]);
    expect(r).toMatchObject({ ok: false, status: 409 }); if (r.ok) return;
    expect(r.error).toMatch(/^Fila 2 \(unidad P-1\): Conflicto de identidad TMS: revisar los vínculos existentes; no se reescriben planes históricos\. No se creó ningún viaje\.$/);
    expect(creadosDestino()).toHaveLength(0); expect(e.origen).toHaveLength(0); expect(e.auditorias).toHaveLength(0);
    expect(conn.rollback).toHaveBeenCalledTimes(1); expect(conn.commit).not.toHaveBeenCalled();
  });
  it("ATRIBUCIÓN: un ErrorCB2 de una fila SIN unidad (la 2.ª) no menciona la placa de la fila anterior (la 1.ª, con unidad); rollback total, 409 y nada creado", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }]);
    const base = vi.mocked(personalDesdeEmpleado).getMockImplementation()!;
    vi.mocked(personalDesdeEmpleado).mockImplementation((async (emp: number, empleadoId: number, ...resto: unknown[]) => {
      if (empleadoId === 3) throw new ErrorCB2("Personal con identidad ambigua; requiere revisión.", 409);   // ErrorCB2 de la fila 2, que no tiene unidad
      return (base as (...a: unknown[]) => unknown)(emp, empleadoId, ...resto);
    }) as never);
    const r = await confirmar([borrador({ fila: 1, unidadPlaca: "P-1", origenPlanId: 900, pilotoEmpleadoId: 1 }), borrador({ fila: 2, unidadPlaca: null, origenPlanId: 901, pilotoEmpleadoId: 3 })]);
    expect(r).toMatchObject({ ok: false, status: 409 }); if (r.ok) return;
    expect(r.error).toBe("Fila 2: Personal con identidad ambigua; requiere revisión. No se creó ningún viaje."); expect(r.error).not.toContain("P-1"); expect(r.error).not.toContain("unidad");
    expect(creadosDestino()).toHaveLength(0); expect(conn.rollback).toHaveBeenCalledTimes(1); expect(conn.commit).not.toHaveBeenCalled();
  });
  it("la validación NO se relaja: el mismo conflicto se rechaza (409), nunca se reescribe la unidad histórica ni se crea una duplicada", async () => {
    const m = conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: null }]);
    const r = await confirmar([borrador({ unidadPlaca: "P-1" })]); expect(r.ok).toBe(false);
    expect(m.modelo.unidades).toEqual([{ id: 601, empresa_id: EMP, placa: "P-1", flota_vehiculo_id: null }]);
  });
  it("unidad TMS ya vinculada a la MISMA unidad de Flota → se reutiliza (mismo unidad_id) y la copia se crea; sin unidad TMS previa → se crea una nueva vinculada, aunque el INSERT devuelva insertId 0", async () => {
    conModelo([{ id: 601, placa: "P-1", flota_vehiculo_id: 1 }]);
    expect(await confirmar([borrador({ unidadPlaca: "P-1" })])).toMatchObject({ ok: true }); expect(creadosDestino()[0].unidad_id).toBe(601);
    const sinUnidad = conModelo([]); expect(await confirmar([borrador({ fila: 1, unidadPlaca: "P-1", origenPlanId: 902, rutaId: 11 })], "2026-09-26")).toMatchObject({ ok: true });
    expect(sinUnidad.modelo.unidades).toEqual([{ id: 900, empresa_id: EMP, placa: "P-1", flota_vehiculo_id: 1 }]);
  });
  it("ErrorCB2 con estado inesperado o errores genéricos siguen sin filtrarse: mensaje genérico 500 y rollback", async () => {
    conModelo([]); conn.execute.mockImplementationOnce(async () => { throw new Error("detalle interno SQL secreto"); });
    const r = await confirmar([borrador({ unidadPlaca: "P-1" })]); expect(r).toMatchObject({ ok: false, status: 500 }); if (!r.ok) expect(r.error).not.toContain("secreto");
  });
});

// ------------------------------------------------------------------ DIAGNÓSTICO de bloqueos por lote y comparación de tarifas
import { diagnosticarBloqueos, sugerenciaDeDiagnostico } from "./programacion-copia-diagnostico";

describe("diagnóstico y avisos: un lote de 66 viajes con recursos repetidos (copia fiel al origen)", () => {
  const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const compartido = { pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [2], unidadPlaca: "P-1", tcVehiculoId: 31 };
  const lote66 = () => Array.from({ length: 66 }, (_, i) => conVentana(i + 1, hora(i * 20), { dias: 0, hora: hora((i + 1) * 20) }, compartido));
  const sinRegreso33 = () => { const f = lote66(); f[32] = { ...f[32], regresoHora: null, regresoOffsetDias: null }; return f; };
  const todasSinRegreso = () => Array.from({ length: 66 }, (_, i) => conVentana(i + 1, hora(i * 20), null, { pilotoEmpleadoId: 100 + Math.floor(i / 2), auxiliarEmpleadoIds: [], unidadPlaca: null }));   // recursos repetidos POR PARES, ninguna con regreso

  it("sin filas problemáticas: 66 ok, sin avisos y diagnóstico vacío", async () => {
    const r = await validarLote(EMP, DESTINO, lote66());
    expect(r.filter((x) => x.estado === "ok")).toHaveLength(66);
    expect(r.every((x) => !x.avisos)).toBe(true);
    expect(diagnosticarBloqueos(r)).toMatchObject({ total: 66, bloqueadas: 0, conAvisos: 0, origenes: [] });
    expect(sugerenciaDeDiagnostico(diagnosticarBloqueos(r))).toBeNull();
  });

  it("CASO REAL (captura): 66 filas sin regreso con recursos repetidos por pares → las 66 se pueden copiar; cada una avisa de su par; ya no hay bloqueo", async () => {
    for (let i = 0; i < 33; i++) empleados[100 + i] = { id: 100 + i, nombre: `Piloto ${i}`, estado: "Activo" };   // 33 personas distintas, cada una en 2 viajes
    const r = await validarLote(EMP, DESTINO, todasSinRegreso());
    expect(r.filter((x) => x.estado === "ok")).toHaveLength(66);
    const d = diagnosticarBloqueos(r);
    expect(d).toMatchObject({ total: 66, bloqueadas: 0, conAvisos: 66, avisosPorTipo: { ventana_incompleta: 66, destino_ocupado: 0 } });
    expect(d.origenes).toHaveLength(66);
    expect(d.origenes.every((o) => o.falta === "regreso" && o.afecta === 1)).toBe(true);   // «Fila N (sin regreso) · comparte con 1», como en la captura
    // y se crean todas, tal como en el origen
    const c = await confirmarAceptando(todasSinRegreso());
    expect(c.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(66);
    for (let i = 0; i < 33; i++) delete empleados[100 + i];
  });

  it("UNA fila sin regreso comparte recursos con las otras 65: las 66 pasan con aviso y la fila origen queda identificada", async () => {
    const r = await validarLote(EMP, DESTINO, sinRegreso33());
    const d = diagnosticarBloqueos(r);
    expect(d).toMatchObject({ bloqueadas: 0, conAvisos: 66, avisosPorTipo: { ventana_incompleta: 66, destino_ocupado: 0 } });
    expect(d.origenes).toEqual([{ fila: 33, falta: "regreso", afecta: 65 }]);
    expect(r[0].avisos?.[0]).toMatchObject({ tipo: "ventana_incompleta", filas: [33] });
    expect(r[0].avisos![0].mensaje).toContain("fila 33: sin regreso estimado");
    expect(r[0].avisos![0].mensaje).toContain("Se copia igual que el origen.");
    expect(sugerenciaDeDiagnostico(d)).toContain("fila 33");
    expect(sugerenciaDeDiagnostico(d)).toContain("comparte recursos con 65 filas");
  });

  it("el diagnóstico NO contiene datos personales (ni nombres, ni placas) aunque los mensajes de las filas sí los tengan", async () => {
    const r = await validarLote(EMP, DESTINO, sinRegreso33());
    expect(r[0].avisos!.map((a) => a.mensaje).join(" ")).toMatch(/Juan Pérez|P-1/);   // los mensajes de fila conservan el contexto operativo
    const d = diagnosticarBloqueos(r);
    const seguro = JSON.stringify({ d, s: sugerenciaDeDiagnostico(d), c: r[0].conflictos, o: r[32].diagnostico });
    expect(seguro).not.toMatch(/Juan|Pérez|P-1|TC-1|Acme|PLAN-/i);
  });

  it("darle regreso a la fila origen QUITA los avisos de las demás (el servidor revalida todo el lote)", async () => {
    const lote = sinRegreso33();
    lote[32] = { ...lote[32], regresoOffsetDias: 0, regresoHora: hora(33 * 20) };   // regreso consecutivo: 33*20 == inicio de la fila 34
    const r = await validarLote(EMP, DESTINO, lote);
    expect(r.filter((x) => x.estado === "ok")).toHaveLength(66);
    expect(r.every((x) => !x.avisos)).toBe(true);
    expect(diagnosticarBloqueos(r)).toMatchObject({ bloqueadas: 0, conAvisos: 0, origenes: [] });
  });

  it("un regreso editado que SE SOLAPA de verdad con la fila siguiente SÍ bloquea (solape real con horas conocidas): solo esas dos filas", async () => {
    const lote = sinRegreso33();
    lote[32] = { ...lote[32], regresoOffsetDias: 0, regresoHora: hora(33 * 20 + 5) };   // invade 5 min la fila 34
    const r = await validarLote(EMP, DESTINO, lote);
    expect(r.filter((x) => x.estado === "error").map((x) => x.fila)).toEqual([33, 34]);
    expect(r[32].conflictos).toEqual(expect.arrayContaining([expect.objectContaining({ causa: "solape" })]));
    const d = diagnosticarBloqueos(r);
    expect(d).toMatchObject({ bloqueadas: 2, conAvisos: 0 });
    expect(d.porMotivo).toMatchObject({ solape_real: 2 });
    expect(r[32].errores.join(" ")).toContain("Los horarios se solapan.");
  });

  it("varias filas sin hora/regreso: se listan ordenadas por alcance y se redacta una sola sugerencia", async () => {
    const lote = lote66();
    lote[9] = { ...lote[9], horaCarga: null };                                   // fila 10 sin hora
    lote[40] = { ...lote[40], regresoHora: null, regresoOffsetDias: null };      // fila 41 sin regreso
    const d = diagnosticarBloqueos(await validarLote(EMP, DESTINO, lote));
    expect(d.origenes.map((o) => o.fila).sort((a, b) => a - b)).toEqual([10, 41]);
    expect(d.origenes[0].afecta).toBeGreaterThanOrEqual(d.origenes[1].afecta);
    expect(sugerenciaDeDiagnostico(d)).toMatch(/2 filas sin hora o regreso válido/);
  });

  it("los errores REALES se cuentan aparte (tarifa no vigente, ruta inactiva) y siguen bloqueando", async () => {
    const filas = [
      borrador({ fila: 1, origenPlanId: 901, tarifaId: 99999, pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], unidadPlaca: null }),
      borrador({ fila: 2, origenPlanId: 902, rutaId: 13, pilotoEmpleadoId: 2, auxiliarEmpleadoIds: [], unidadPlaca: null }),
      borrador({ fila: 3, origenPlanId: 903, pilotoEmpleadoId: 3, auxiliarEmpleadoIds: [], unidadPlaca: null }),
    ];
    const d = diagnosticarBloqueos(await validarLote(EMP, DESTINO, filas));
    expect(d).toMatchObject({ total: 3, bloqueadas: 2, conAvisos: 0 });
    expect(d.porMotivo).toMatchObject({ tarifa: 1, otro: 1, solape_real: 0 });
  });

  it("el recurso ocupado en el DESTINO cuenta como aviso `destino_ocupado`, no como bloqueo", async () => {
    e.planes.push(plan({ id: 50, codigo: "PLAN-EXISTENTE", piloto_id: 501 }));
    const d = diagnosticarBloqueos(await validarLote(EMP, DESTINO, [borrador({ pilotoEmpleadoId: 1 })]));
    expect(d).toMatchObject({ bloqueadas: 0, conAvisos: 1, avisosPorTipo: { destino_ocupado: 1, ventana_incompleta: 0 } });
  });
});

describe("confirmación del lote de 66: atómica, con permisos de la ruta y sin duplicar", () => {
  const hora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const lote = () => Array.from({ length: 66 }, (_, i) => conVentana(i + 1, hora(i * 20), { dias: 0, hora: hora((i + 1) * 20) }, { pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [2], unidadPlaca: "P-1", tcVehiculoId: 31 }));
  it("con UNA fila sin regreso el lote se copia COMPLETO (copia fiel): 66 viajes, ninguno duplicado en el reintento", async () => {
    const f = lote(); f[32] = { ...f[32], regresoHora: null, regresoOffsetDias: null };
    const r = await confirmarAceptando(f);
    expect(r.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(66);
    expect((await confirmar(f)).ok).toBe(false);          // reintento: «ya fue copiado», no duplica
    expect(creadosDestino()).toHaveLength(66);
  });
  it("con UNA fila con un error REAL (ruta inactiva) el lote completo se rechaza (todo o nada): no se crea nada", async () => {
    const f = lote(); f[10] = { ...f[10], rutaId: 13 };
    const r = await confirmar(f);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(creadosDestino()).toHaveLength(0);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    if (!r.ok) expect(r.erroresPorFila).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ ACEPTACIÓN de avisos VERIFICADA EN EL SERVIDOR (no se puede omitir con una llamada directa)
describe("aceptación de avisos: el servidor verifica la huella de los avisos VIGENTES al confirmar", () => {
  const ocuparPiloto = (id = 50, codigo = "PLAN-EXISTENTE") => e.planes.push(plan({ id, codigo, piloto_id: 501 }));
  const filaOcupada = () => [borrador({ pilotoEmpleadoId: 1 })];
  const sinCrear = () => { expect(creadosDestino()).toHaveLength(0); expect(conn.beginTransaction).not.toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled(); };

  it("sin avisos NO se exige aceptación (comportamiento de siempre)", async () => {
    const r = await confirmar([borrador()]);
    expect(r.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(1);
  });

  it("con avisos y SIN aceptación (llamada directa que la omite): 409 requiereRevalidar, sin escribir nada", async () => {
    ocuparPiloto();
    const r = await confirmar(filaOcupada());
    expect(r).toMatchObject({ ok: false, status: 409, requiereRevalidar: true, error: expect.stringContaining("avisos de la copia sin aceptar") });
    expect(r.ok === false && r.erroresPorFila).toBeUndefined();
    sinCrear();
  });

  it.each([["cadena vacía", ""], ["valor arbitrario", "aceptado"], ["huella con formato válido pero inventada", "a".repeat(64)]])("con una aceptación inválida (%s) también se rechaza", async (_n, falsa) => {
    ocuparPiloto();
    const r = await confirmar(filaOcupada(), DESTINO, falsa);
    expect(r).toMatchObject({ ok: false, status: 409, requiereRevalidar: true });
    sinCrear();
  });

  it("con la huella VIGENTE (la que el servidor entregó en la validación) la copia se crea", async () => {
    ocuparPiloto();
    const r = await confirmar(filaOcupada(), DESTINO, await huellaDe(filaOcupada()));
    expect(r.ok).toBe(true);
    expect(creadosDestino()).toHaveLength(1);
  });

  it("DESACTUALIZADA por otro VIAJE que ocupa el recurso (mismo recurso, otro plan): se rechaza", async () => {
    ocuparPiloto(50, "PLAN-A");
    const aceptada = await huellaDe(filaOcupada());
    e.planes = e.planes.filter((p) => p.id !== 50);
    ocuparPiloto(51, "PLAN-B");                                   // otro viaje ocupa ahora al piloto
    expect(await huellaDe(filaOcupada())).not.toBe(aceptada);
    sinCrearDespues(await confirmar(filaOcupada(), DESTINO, aceptada));
  });

  it("DESACTUALIZADA por otro RECURSO afectado (antes el piloto, ahora la unidad): se rechaza", async () => {
    ocuparPiloto();
    const aceptada = await huellaDe(filaOcupada());
    e.planes = e.planes.filter((p) => p.id !== 50);
    e.planes.push(plan({ id: 50, codigo: "PLAN-EXISTENTE", unidad_id: 601 }));   // ahora choca la unidad P-1, no el piloto
    const r = await confirmar([borrador({ pilotoEmpleadoId: 1, unidadPlaca: "P-1" })], DESTINO, aceptada);
    expect(r).toMatchObject({ ok: false, status: 409, requiereRevalidar: true });
    sinCrear();
  });

  it("DESACTUALIZADA por otras FILAS relacionadas (se agrega otra fila sin regreso que comparte el recurso): se rechaza", async () => {
    const dos = [conVentana(1, "05:00", null, { pilotoEmpleadoId: 1 }), conVentana(2, "20:00", null, { pilotoEmpleadoId: 1 })];
    const aceptada = await huellaDe(dos);
    const tres = [...dos, conVentana(3, "22:00", null, { pilotoEmpleadoId: 1 })];
    expect(await huellaDe(tres)).not.toBe(aceptada);
    const r = await confirmar(tres, DESTINO, aceptada);
    expect(r).toMatchObject({ ok: false, status: 409, requiereRevalidar: true });
    sinCrear();
    // y con las filas originales la misma aceptación sí vale
    expect((await confirmar(dos, DESTINO, aceptada)).ok).toBe(true);
  });

  it("la aceptación está ligada al CONTEXTO: la de otra fecha destino no sirve", async () => {
    ocuparPiloto();
    const deOtraFecha = await huellaDe(filaOcupada(), "2026-09-26");
    const r = await confirmar(filaOcupada(), DESTINO, deOtraFecha || "b".repeat(64));
    expect(r).toMatchObject({ ok: false, status: 409, requiereRevalidar: true });
    sinCrear();
  });

  it("los errores REALES tienen prioridad: se devuelven por fila (sin pedir aceptación) y todo el lote se rechaza", async () => {
    ocuparPiloto();
    const r = await confirmar([...filaOcupada(), borrador({ fila: 2, origenPlanId: 901, rutaId: 13, unidadPlaca: null, pilotoEmpleadoId: 3 })]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.ok === false && r.requiereRevalidar).toBeUndefined();
    expect(r.ok === false && r.erroresPorFila).toHaveLength(1);
    sinCrear();
  });

  it("la verificación ocurre BAJO EL CANDADO y antes de cualquier escritura: un rechazo libera el candado y no deja trazas", async () => {
    ocuparPiloto();
    conn.query.mockClear();
    await confirmar(filaOcupada());
    const sqls = conn.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((q) => q.includes("GET_LOCK"))).toBe(true);
    expect(sqls.some((q) => q.includes("RELEASE_LOCK"))).toBe(true);
    expect(e.auditorias).toHaveLength(0);
    expect(e.origen).toHaveLength(0);
  });
});
const sinCrearDespues = (r: Awaited<ReturnType<typeof confirmarLote>>) => {
  expect(r).toMatchObject({ ok: false, status: 409, requiereRevalidar: true });
  expect(creadosDestino()).toHaveLength(0);
  expect(conn.beginTransaction).not.toHaveBeenCalled();
};
