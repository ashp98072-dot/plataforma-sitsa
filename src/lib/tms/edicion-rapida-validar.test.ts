import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-1: validación de solo lectura del ESTADO FINAL del lote. BD simulada en memoria que
 * respeta el SQL real que se envía; el motor de intervalos y los helpers de validación son los de producción.
 * Fechas relativas a hoyLocal().
 */
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn(() => { throw new Error("validar NO debe abrir conexiones/transacciones"); }) }));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(async () => []),
  personalRecienAsignadoDelPlan: vi.fn(() => []),
}));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("@/lib/tms/tc-plan", () => ({ resolverTcInterno: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { hoyLocal } from "@/lib/rrhh/dates";
import { personalDesdeEmpleado, validarPersonalId } from "@/lib/tms/personal-resolucion";
import { resolverTcInterno } from "@/lib/tms/tc-plan";
import { listarViaticosRechazadosDelPlan } from "@/lib/tms/viaticos";
import { emularConsultaConflictoPersonal, type PersonalModelo } from "@/lib/tms/personal-identidad.fixture";
import { ESTADOS_ASIGNACION_DIARIA } from "./disponibilidad-programacion-dia";
import { validarEdicionRapidaSchema, MAX_FILAS_EDICION_RAPIDA, type ValidarEdicionRapida } from "./edicion-rapida-schema";
import { validarEdicionRapida } from "./edicion-rapida-validar";

const EMP = 7;
const sumarDias = (fecha: string, n: number) => { const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const HOY = hoyLocal();
const D0 = sumarDias(HOY, 10);
const D1 = sumarDias(D0, 1);
const AYER = sumarDias(HOY, -1);

type Persona = PersonalModelo & { estado: string };
type Plan = {
  id: number; empresa_id: number; codigo: string; estado: string; fecha: string; hora: string | null; regreso: string | null; tipo_viaje: string;
  piloto_id: number | null; aux: number[]; unidad_placa: string | null; unidad_tms: number | null; flota: number | null; tc: number | null;
};
let personal: Persona[];
let planes: Plan[];
let viaticos: { plan_id: number; personal_id: number; estado: string }[];
let sqls: string[];
let engineExcluidos: number[][];

const persona = (id: number, nombre: string, idEmpleado: number | null, tipo: "Piloto" | "Auxiliar" = "Piloto"): Persona => ({ id, empresa_id: EMP, nombre, tipo, id_empleado: idEmpleado, estado: "Activo" });
const plan = (id: number, over: Partial<Plan> = {}): Plan => ({
  id, empresa_id: EMP, codigo: `PLAN-${id}`, estado: "Programado", fecha: D0, hora: "05:00:00", regreso: `${D0} 08:00:00`, tipo_viaje: "Propio",
  piloto_id: null, aux: [], unidad_placa: null, unidad_tms: null, flota: null, tc: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  sqls = [];
  engineExcluidos = [];
  viaticos = [];
  personal = [persona(10, "Carlos", 100), persona(11, "Juan", 101), persona(12, "Luis", 102), persona(13, "Juan (aux)", 101, "Auxiliar"), persona(20, "Pedro", 200, "Auxiliar"), persona(21, "Mario", 201, "Auxiliar")];
  planes = [
    plan(101, { piloto_id: 10, aux: [20], unidad_placa: "C-30", unidad_tms: 300, flota: 30, tc: 40 }),
    plan(102, { hora: "08:00:00", regreso: `${D0} 11:00:00`, piloto_id: 11, unidad_placa: "C-31", unidad_tms: 301, flota: 31, tc: 41 }),
    plan(103, { hora: "11:00:00", regreso: `${D0} 13:00:00`, piloto_id: 12 }),
  ];
  vi.mocked(execute).mockRejectedValue(new Error("validar NO debe escribir"));
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql);
    sqls.push(s);
    const empresa = Number(params[0]);
    if (s.includes("FROM tms_planes_viaje p") && s.includes("LEFT JOIN tms_unidades u ON u.id = p.unidad_id") && s.includes("p.id IN")) {
      const ids = params.slice(1) as number[];
      return planes.filter((p) => p.empresa_id === empresa && ids.includes(p.id)).map((p) => ({
        id: p.id, codigo: p.codigo, estado: p.estado, fecha_plan: p.fecha, hora_carga: p.hora, regreso_estimado: p.regreso, tipo_viaje: p.tipo_viaje, piloto_id: p.piloto_id,
        unidad_id: p.unidad_tms, unidad_placa: p.unidad_placa, flota_vehiculo_id: p.flota, tc_vehiculo_id: p.tc, piloto_nombre: personal.find((x) => x.id === p.piloto_id)?.nombre ?? null, pendiente_cierre: 0,
      }));
    }
    if (s.includes("FROM tms_plan_auxiliares pa") && s.includes("per.empresa_id = ?")) {
      const ids = params.slice(1) as number[];
      return planes.filter((p) => ids.includes(p.id) && p.empresa_id === empresa).flatMap((p) => p.aux.map((a, i) => ({ plan_id: p.id, personal_id: a, nombre: personal.find((x) => x.id === a)?.nombre, orden: i + 1 })));
    }
    if (s.startsWith("SELECT id, id_empleado, nombre FROM tms_personal WHERE empresa_id")) {
      const ids = params.slice(1) as number[];
      return personal.filter((p) => p.empresa_id === empresa && ids.includes(p.id)).map((p) => ({ id: p.id, id_empleado: p.id_empleado, nombre: p.nombre }));
    }
    if (s.includes("FROM tms_unidades WHERE empresa_id")) {
      const placas = params.slice(1) as string[];
      return [...new Map(planes.filter((p) => p.unidad_placa && placas.includes(p.unidad_placa)).map((p) => [p.unidad_placa, { id: p.unidad_tms, placa: p.unidad_placa }])).values()];
    }
    if (s.includes("FROM tms_viaticos") && s.includes("estado != 'PROGRAMADO'")) {
      const [planId, ...ids] = params as number[];
      return viaticos.filter((v) => v.plan_id === planId && ids.includes(v.personal_id));
    }
    // ---- motor de disponibilidad por intervalos (REAL): emulación del SQL enviado
    const n = ESTADOS_ASIGNACION_DIARIA.length;
    if (s.includes("p.fecha_plan <= ?")) {
      const nEx = (/p\.id NOT IN \(([?,]+)\)/.exec(s)?.[1].split(",").length) ?? 0;
      const excl = (nEx ? params.slice(-nEx) : []) as number[];
      engineExcluidos.push(excl);
      const fechaFin = String(params[1 + n]), fechaInicio = String(params[2 + n]), inicio = String(params[3 + n]);
      const visible = (p: Plan) => p.empresa_id === empresa && (ESTADOS_ASIGNACION_DIARIA as readonly string[]).includes(p.estado) && p.tipo_viaje !== "Tercerizado" && !excl.includes(p.id)
        && p.fecha <= fechaFin && (p.fecha >= fechaInicio || (p.regreso != null && p.regreso > inicio));
      const fila = (p: Plan, rid: unknown, nombre: unknown) => ({ recurso_id: rid, nombre, plan_id: p.id, codigo: p.codigo, fecha_plan: p.fecha, hora_carga: p.hora, regreso_estimado: p.regreso });
      if (s.includes("FROM tms_personal tp")) {
        const modelo = { personal: personal as PersonalModelo[], planes: planes.filter((p) => p.tipo_viaje !== "Tercerizado").map((p) => ({ id: p.id, empresa_id: p.empresa_id, codigo: p.codigo, estado: p.estado, inicio: `${p.fecha} ${(p.hora ?? "00:00:00")}`, regreso_estimado: p.regreso, piloto_id: p.piloto_id, auxiliares: p.aux, hora_carga: p.hora })) };
        return emularConsultaConflictoPersonal(modelo, s, params);
      }
      if (s.includes("FROM tms_unidades u")) {
        const ids = params.slice(4 + n, params.length - nEx) as number[];
        return planes.filter((p) => visible(p) && p.unidad_tms != null && ids.includes(p.unidad_tms)).map((p) => fila(p, p.unidad_tms, p.unidad_placa));
      }
      if (s.includes("p.tc_vehiculo_id = v.id")) {
        const ids = params.slice(4 + n, params.length - nEx) as number[];
        return planes.filter((p) => visible(p) && p.tc != null && ids.includes(p.tc)).map((p) => fila(p, p.tc, `TC-${p.tc}`));
      }
    }
    return [];
  }) as never);

  vi.mocked(validarPersonalId).mockImplementation((async (empresa: number, id: number, tipo: string) => {
    const p = personal.find((x) => x.id === id && x.empresa_id === empresa && x.tipo === tipo && x.estado === "Activo");
    return p ? { id: p.id, nombre: p.nombre } : null;
  }) as never);
  vi.mocked(listarDisponibilidadPersonal).mockImplementation((async () => personal.map((p) => ({
    personalId: p.id, nombre: p.nombre, incidenciasBloqueantes: [], viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [],
  }))) as never);
  vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (_e: number, id: number) => ({ id, placa: `C-${id}` })) as never);
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [30, 31, 32, 33].map((id) => ({ id, placa: `C-${id}`, tipoUnidad: "Camion", estadoDisponibilidad: "disponible", viajeAbierto: null })) } as never);
  vi.mocked(resolverTcInterno).mockImplementation((async (_e: number, id: number) => ({ ok: true, vehiculoId: id, placa: `TC-${id}` })) as never);
});

/** Fila del payload a partir del plan del modelo (esperado = lo que la BD tiene) + cambios sobre los cuatro recursos. */
const cambio = (planId: number, nuevo: Partial<{ pilotoPersonalId: number | null; auxiliarPersonalIds: number[]; flotaVehiculoId: number | null; tcVehiculoId: number | null }> = {}, esperado: Record<string, unknown> = {}) => {
  const p = planes.find((x) => x.id === planId) ?? plan(planId);
  return {
    planId,
    esperado: { estado: p.estado, fechaPlan: p.fecha, horaCarga: p.hora ? p.hora.slice(0, 5) : null, regresoEstimado: p.regreso ? p.regreso.slice(0, 16).replace(" ", "T") : null,
      pilotoPersonalId: p.piloto_id, auxiliarPersonalIds: p.aux, flotaVehiculoId: p.flota, tcVehiculoId: p.tc, ...esperado },
    nuevo: { pilotoPersonalId: p.piloto_id, auxiliarPersonalIds: p.aux, flotaVehiculoId: p.flota, tcVehiculoId: p.tc, ...nuevo },
  };
};
const validar = (cambios: ReturnType<typeof cambio>[], motivoCambio: string | undefined = "Piloto no se presentó") =>
  validarEdicionRapida(EMP, validarEdicionRapidaSchema.parse({ motivoCambio, cambios }) as ValidarEdicionRapida);
const fila = (r: Awaited<ReturnType<typeof validar>>, planId: number) => r.filas.find((f) => f.planId === planId)!;
const codigos = (r: Awaited<ReturnType<typeof validar>>, planId: number) => fila(r, planId).errores.map((e) => e.codigo);

describe("esquema (cuerpo estricto)", () => {
  it("1) payload vacío o sin cambios es inválido", () => {
    expect(validarEdicionRapidaSchema.safeParse({}).success).toBe(false);
    expect(validarEdicionRapidaSchema.safeParse({ cambios: [] }).success).toBe(false);
  });
  it("2) planId duplicado en el lote es inválido", () => {
    const c = cambio(101);
    expect(validarEdicionRapidaSchema.safeParse({ cambios: [c, c] }).success).toBe(false);
  });
  it("34) máximo de filas: 200 sí, 201 no", () => {
    const filas = (n: number) => Array.from({ length: n }, (_, i) => cambio(1000 + i));
    expect(validarEdicionRapidaSchema.safeParse({ cambios: filas(MAX_FILAS_EDICION_RAPIDA) }).success).toBe(true);
    expect(validarEdicionRapidaSchema.safeParse({ cambios: filas(MAX_FILAS_EDICION_RAPIDA + 1) }).success).toBe(false);
  });
  it("estricto: rechaza empresaId, campos de fecha/hora/regreso/estado en `nuevo` y auxiliares repetidos", () => {
    const base = cambio(101);
    expect(validarEdicionRapidaSchema.safeParse({ empresaId: 9, cambios: [base] }).success).toBe(false);
    expect(validarEdicionRapidaSchema.safeParse({ cambios: [{ ...base, empresaId: 9 }] }).success).toBe(false);
    for (const extra of [{ fechaPlan: D0 }, { horaCarga: "05:00" }, { regresoEstimado: `${D0}T08:00` }, { estado: "Cancelado" }, { rutaId: 3 }, { tarifaId: 2 }]) {
      expect(validarEdicionRapidaSchema.safeParse({ cambios: [{ ...base, nuevo: { ...base.nuevo, ...extra } }] }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(validarEdicionRapidaSchema.safeParse({ cambios: [{ ...base, nuevo: { ...base.nuevo, auxiliarPersonalIds: [20, 20] } }] }).success).toBe(false);
  });
});

describe("lectura del plan, snapshot esperado y reglas por fila", () => {
  it("3) un plan de OTRA empresa no existe para esta sesión", async () => {
    planes.push(plan(900, { empresa_id: 8, piloto_id: 10 }));
    const r = await validar([cambio(900, { pilotoPersonalId: 12 })]);
    expect(codigos(r, 900)).toEqual(["PLAN_NO_ENCONTRADO"]);
    expect(r.ok).toBe(false);
    for (const [, params] of vi.mocked(query).mock.calls) expect((params as unknown[])[0]).toBe(EMP);
  });

  it("4) snapshot esperado coincide (incluye hora con segundos, regreso con T y auxiliares como conjunto): sin desactualizado", async () => {
    planes[0].aux = [20, 21];
    const r = await validar([cambio(101, { pilotoPersonalId: 12 }, { auxiliarPersonalIds: [21, 20] })]);
    expect(codigos(r, 101)).not.toContain("PLAN_DESACTUALIZADO");
  });

  it("5) snapshot desactualizado: por cada campo que difiere de la BD", async () => {
    const c = (esperado: Record<string, unknown>) => validar([cambio(101, { pilotoPersonalId: 12 }, esperado)]);
    for (const esperado of [{ estado: "Cargado" }, { fechaPlan: D1 }, { horaCarga: "06:00" }, { regresoEstimado: `${D0}T09:00` }, { pilotoPersonalId: 11 }, { auxiliarPersonalIds: [] }, { flotaVehiculoId: 31 }, { tcVehiculoId: 42 }]) {
      const r = await c(esperado);
      expect(codigos(r, 101), JSON.stringify(esperado)).toEqual(["PLAN_DESACTUALIZADO"]);
      expect(fila(r, 101).estado).toBe("error");
    }
    expect((await c({ pilotoPersonalId: 11 })).filas[0].errores[0].mensaje).toContain("piloto");
  });

  it("6/7) Cerrado y Cancelado no son editables", async () => {
    for (const estado of ["Cerrado", "Cancelado"]) {
      planes[0].estado = estado;
      const r = await validar([cambio(101, { pilotoPersonalId: 12 })]);
      expect(codigos(r, 101), estado).toEqual(["ESTADO_NO_EDITABLE"]);
      expect(fila(r, 101).errores[0].mensaje).toContain(`"${estado}"`);
    }
  });

  it("8) fecha pasada no editable; hoy sí", async () => {
    planes[0].fecha = AYER; planes[0].regreso = `${AYER} 08:00:00`;
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual(["FECHA_PASADA"]);
    planes[0].fecha = HOY; planes[0].regreso = `${HOY} 08:00:00`;
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual([]);
  });

  it("9/30) Tercerizado no usa recursos internos: cambiarlos es error; sin cambios no; y no consume recursos en el lote", async () => {
    planes.push(plan(104, { tipo_viaje: "Tercerizado", piloto_id: 12, hora: "05:00:00", regreso: `${D0} 08:00:00` })); // dato legado con piloto interno
    expect(codigos(await validar([cambio(104, { pilotoPersonalId: 11 })]), 104)).toEqual(["TERCERIZADO_SIN_RECURSOS_INTERNOS"]);
    expect(fila(await validar([cambio(104)]), 104).estado).toBe("sin_cambios");
    // el Tercerizado (aunque conserve un piloto legado) no bloquea a otro viaje que toma a Luis
    const r = await validar([cambio(104), cambio(101, { pilotoPersonalId: 12 })]);
    expect(fila(r, 101).estado).toBe("ok");
    expect(r.ok).toBe(true);
  });

  it("10/11) piloto y auxiliar inválidos (inexistente, otro tipo, otra empresa o inactivo)", async () => {
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 999 })]), 101)).toEqual(["PERSONAL_INVALIDO"]);
    expect(fila(await validar([cambio(101, { pilotoPersonalId: 20 })]), 101).errores[0].mensaje).toBe("El piloto seleccionado no existe o no pertenece a esta empresa."); // 20 es Auxiliar
    const aux = await validar([cambio(101, { auxiliarPersonalIds: [20, 999] })]);
    expect(fila(aux, 101).errores[0]).toMatchObject({ codigo: "PERSONAL_INVALIDO", mensaje: "Un auxiliar seleccionado no existe o no pertenece a esta empresa (id 999)." });
    personal.find((p) => p.id === 12)!.estado = "Baja";
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual(["PERSONAL_INVALIDO"]);
  });

  it("personal no disponible (incidencia bloqueante / de baja) y viaje en curso hoy", async () => {
    vi.mocked(listarDisponibilidadPersonal).mockResolvedValue(personal.map((p) => ({
      personalId: p.id, nombre: p.nombre, incidenciasBloqueantes: p.id === 12 ? [{ tipo: "Vacaciones", fechaInicio: D0, fechaFin: D0 }] : [],
      viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [],
    })) as never);
    const r = await validar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(fila(r, 101).errores[0]).toMatchObject({ codigo: "PERSONAL_NO_DISPONIBLE" });
    expect(fila(r, 101).errores[0].mensaje).toContain("Vacaciones");
  });

  it("12) unidad inválida: inexistente/inaccesible, clasificada como TC, inactiva", async () => {
    vi.mocked(obtenerVehiculoAccesible).mockResolvedValue(null as never);
    expect(fila(await validar([cambio(101, { flotaVehiculoId: 32 })]), 101).errores[0]).toMatchObject({ codigo: "UNIDAD_INVALIDA", mensaje: "La unidad seleccionada no existe o no es accesible para esta empresa." });
    vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (_e: number, id: number) => ({ id, placa: `C-${id}` })) as never);
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [{ id: 32, placa: "C-32", tipoUnidad: "TC", estadoDisponibilidad: "disponible" }, { id: 33, placa: "C-33", tipoUnidad: "Camion", estadoDisponibilidad: "inactivo" }] } as never);
    expect(fila(await validar([cambio(101, { flotaVehiculoId: 32 })]), 101).errores[0].mensaje).toContain("clasificada como TC");
    expect(fila(await validar([cambio(101, { flotaVehiculoId: 33 })]), 101).errores[0].mensaje).toBe("La unidad seleccionada está inactiva.");
  });

  it("13) TC inválido: el mensaje y el código vienen del validador de TC", async () => {
    vi.mocked(resolverTcInterno).mockResolvedValue({ ok: false, status: 409, error: "El TC TC-99 está actualmente en taller." } as never);
    expect(fila(await validar([cambio(101, { tcVehiculoId: 99 })]), 101).errores[0]).toEqual({ codigo: "TC_INVALIDO", mensaje: "El TC TC-99 está actualmente en taller." });
  });

  it("14) un viático ya procesado impide retirar a la persona (solo lectura)", async () => {
    viaticos = [{ plan_id: 101, personal_id: 10, estado: "AUTORIZADO" }];
    const r = await validar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(fila(r, 101).errores[0]).toMatchObject({ codigo: "VIATICO_PROCESADO", mensaje: "No se puede quitar a Carlos del viaje porque su viático ya fue autorizado." });
    viaticos = [];
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual([]);
    // quitar a un auxiliar con viático procesado
    viaticos = [{ plan_id: 101, personal_id: 20, estado: "ENTREGADO" }];
    expect(codigos(await validar([cambio(101, { auxiliarPersonalIds: [] })]), 101)).toEqual(["VIATICO_PROCESADO"]);
  });

  it("35) el motivo es UNO por lote y se exige a TODA fila con cambio real (no a las sin cambios)", async () => {
    const sinMotivo = await validar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { auxiliarPersonalIds: [21] }), cambio(103)], "   ");
    expect(codigos(sinMotivo, 101)).toContain("MOTIVO_REQUERIDO");
    expect(codigos(sinMotivo, 102)).toContain("MOTIVO_REQUERIDO");
    expect(fila(sinMotivo, 103).estado).toBe("sin_cambios");
    expect(fila(sinMotivo, 101).errores.find((e) => e.codigo === "MOTIVO_REQUERIDO")!.mensaje).toBe("Indica el motivo del cambio de piloto, unidad o auxiliares.");
    const conMotivo = await validar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { auxiliarPersonalIds: [21] })], "Cambio operativo");
    expect(conMotivo.filas.flatMap((f) => f.errores.map((e) => e.codigo))).not.toContain("MOTIVO_REQUERIDO");
  });
});

describe("cambios simples y conflictos contra la BD", () => {
  it("15) sin cambios: estado sin_cambios y ok (aunque otras filas tengan cambios)", async () => {
    const solo = await validar([cambio(101)]);
    expect(solo).toEqual({ ok: true, filas: [{ planId: 101, estado: "sin_cambios", errores: [], advertencias: [] }] });
    const mixto = await validar([cambio(101), cambio(102, { pilotoPersonalId: 10 })]);
    expect(mixto.filas.map((f) => f.estado)).toEqual(["sin_cambios", "ok"]);
  });

  it("15b) una fila Cerrada SIN cambios no da error artificial", async () => {
    planes[0].estado = "Cerrado";
    expect(fila(await validar([cambio(101)]), 101).estado).toBe("sin_cambios");
  });

  it("16) cambio simple válido", async () => {
    const r = await validar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(r).toEqual({ ok: true, filas: [{ planId: 101, estado: "ok", errores: [], advertencias: [] }] });
  });

  it("17) conflicto contra un plan EXTERNO al lote (BD)", async () => {
    planes.push(plan(104, { piloto_id: 12, hora: "06:00:00", regreso: `${D0} 07:00:00` }));
    const r = await validar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(fila(r, 101).errores[0]).toMatchObject({ codigo: "RECURSO_OCUPADO_BD", mensaje: `El piloto Luis ya está asignado al PLAN-104 para el ${D0.split("-").reverse().join("/")}.` });
  });

  it("18/19) se excluyen de la BD TODOS los planes del lote (no solo el propio) y con parámetros", async () => {
    await validar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(engineExcluidos.length).toBeGreaterThan(0);
    for (const excl of engineExcluidos) expect(excl.sort()).toEqual([101, 102]);
    expect(sqls.filter((s) => s.includes("p.id NOT IN (?,?)")).length).toBe(engineExcluidos.length);
  });

  it("23) piloto vs auxiliar: la MISMA persona (id_empleado) con otra fila de tms_personal choca contra BD", async () => {
    planes.push(plan(104, { piloto_id: 11, hora: "06:00:00", regreso: `${D0} 07:00:00` })); // Juan (personal 11, empleado 101) fuera del lote
    const r = await validar([cambio(101, { auxiliarPersonalIds: [20, 13] })]); // "Juan (aux)" = personal 13, mismo empleado 101
    expect(codigos(r, 101)).toEqual(["RECURSO_OCUPADO_BD"]);
    expect(fila(r, 101).errores[0].mensaje).toContain("PLAN-104");
  });

  it("24) auxiliar adicional nuevo choca contra BD; el auxiliar que ya estaba no se revalida", async () => {
    planes.push(plan(104, { piloto_id: 12, aux: [21], hora: "06:00:00", regreso: `${D0} 07:00:00` }));
    const r = await validar([cambio(101, { auxiliarPersonalIds: [20, 21] })]);
    expect(fila(r, 101).errores[0]).toMatchObject({ codigo: "RECURSO_OCUPADO_BD" });
    expect(fila(r, 101).errores[0].mensaje).toContain("El auxiliar Mario");
  });

  it("unidad y TC nuevos chocan contra BD (unidad por placa existente en tms_unidades)", async () => {
    planes.push(plan(104, { piloto_id: null, unidad_placa: "C-33", unidad_tms: 303, flota: 33, tc: 43, hora: "06:00:00", regreso: `${D0} 07:00:00` }));
    expect(codigos(await validar([cambio(101, { flotaVehiculoId: 33 })]), 101)).toEqual(["RECURSO_OCUPADO_BD"]);
    expect(codigos(await validar([cambio(101, { tcVehiculoId: 43 })]), 101)).toEqual(["RECURSO_OCUPADO_BD"]);
  });

  it("28) borde exacto fin == inicio se permite; un minuto de solape no", async () => {
    planes.push(plan(104, { piloto_id: 12, hora: "08:00:00", regreso: `${D0} 10:00:00` }));
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual([]); // 05-08 vs 08-10
    planes[3].hora = "07:59:00";
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual(["RECURSO_OCUPADO_BD"]);
  });

  it("existente sin regreso reserva todo su día; otro día no", async () => {
    planes.push(plan(104, { piloto_id: 12, hora: "20:00:00", regreso: null }));
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual(["RECURSO_OCUPADO_BD"]);
    planes[3].fecha = D1;
    expect(codigos(await validar([cambio(101, { pilotoPersonalId: 12 })]), 101)).toEqual([]);
  });
});

describe("estado FINAL del lote: intercambios y rotaciones", () => {
  it("20) intercambio válido: Plan 1 05-08 Carlos y Plan 2 08-11 Juan => Plan 1 Juan y Plan 2 Carlos", async () => {
    const r = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r.ok).toBe(true);
    expect(r.filas.map((f) => f.estado)).toEqual(["ok", "ok"]);
  });

  it("21) intercambio con ventanas que se solapan (05-09 y 08-11): es VÁLIDO, porque cada persona termina en un solo viaje", async () => {
    planes[0].regreso = `${D0} 09:00:00`;
    const r = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r.ok).toBe(true);
  });

  it("21b) SOLAPE real: una persona termina en dos viajes cuyas ventanas se pisan => error en la fila que la asigna", async () => {
    planes[0].regreso = `${D0} 09:00:00`; // 05-09 vs 08-11
    // A toma a Juan y B (en el lote, sin cambios) sigue con Juan
    const r = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102)]);
    expect(codigos(r, 101)).toEqual(["RECURSO_OCUPADO_LOTE"]);
    expect(fila(r, 101).errores[0].mensaje).toBe("Juan queda asignado también en el viaje PLAN-102 de este mismo lote con horarios que se solapan.");
    expect(fila(r, 102).estado).toBe("sin_cambios");
    // ambas filas toman a Juan a la vez: se marcan las dos
    const ambas = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 11, auxiliarPersonalIds: [21] })]);
    expect(codigos(ambas, 101)).toEqual(["RECURSO_OCUPADO_LOTE"]);
    expect(ambas.ok).toBe(false);
  });

  it("22) rotación de 3 pilotos A->B, B->C, C->A: válida (cada persona queda en un solo viaje), con o sin solape", async () => {
    const rotar = () => validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 12 }), cambio(103, { pilotoPersonalId: 10 })]);
    const r = await rotar();
    expect(r.ok).toBe(true);
    expect(r.filas.map((f) => f.estado)).toEqual(["ok", "ok", "ok"]);
    planes[2].hora = "10:00:00"; // C (10-13) pisa a B (08-11): sigue siendo válido
    expect((await rotar()).ok).toBe(true);
  });

  it("22b) rotación que deja a una persona en dos viajes solapados => error", async () => {
    planes[2].hora = "10:00:00"; // B 08-11 y C 10-13 se pisan
    const r = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 12 }), cambio(103, { pilotoPersonalId: 12 })]);
    expect(r.ok).toBe(false);
    expect(codigos(r, 102)).toEqual(["RECURSO_OCUPADO_LOTE"]); // la fila que ASIGNA a Luis (C ya lo tenía: no se marca)
    expect(fila(r, 103).estado).toBe("sin_cambios");
  });

  it("recurso que SALE del lote: la fila A toma a Juan y B (fuera del payload) sigue usando a Juan en una ventana solapada => bloquea", async () => {
    planes[0].regreso = `${D0} 09:00:00`; // A 05-09; B (102) 08-11 usa a Juan y NO está en el payload
    const r = await validar([cambio(101, { pilotoPersonalId: 11 })]);
    expect(fila(r, 101).errores[0]).toMatchObject({ codigo: "RECURSO_OCUPADO_BD" });
    expect(fila(r, 101).errores[0].mensaje).toContain("PLAN-102");
  });

  it("29) recurso liberado por otra fila: Juan sale de B (dentro del lote) y por eso ya no bloquea a A", async () => {
    planes[0].regreso = `${D0} 09:00:00`; // A 05-09 y B 08-11 se solapan: con el estado viejo Juan chocaría
    const r = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 12 })]);
    expect(r.ok).toBe(true);
    expect(r.filas.map((f) => f.estado)).toEqual(["ok", "ok"]);
    // si B dejara a Juan pero otra fila del lote lo vuelve a tomar en la misma ventana, sí falla
    planes[2].hora = "08:30:00";
    const r2 = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 12 }), cambio(103, { pilotoPersonalId: 11 })]);
    expect(r2.ok).toBe(false);
  });

  it("23b) misma persona física (dos filas de tms_personal) entre filas del lote: piloto vs auxiliar", async () => {
    planes[0].regreso = `${D0} 09:00:00`; // A 05-09
    const r = await validar([cambio(101, { auxiliarPersonalIds: [20, 13] }), cambio(102, { pilotoPersonalId: 11 })]); // 13 = Juan (aux); B mantiene a Juan piloto 08-11
    expect(codigos(r, 101)).toEqual(["RECURSO_OCUPADO_LOTE"]);
    expect(fila(r, 102).estado).toBe("sin_cambios"); // la fila que no cambió no se marca
  });

  it("25) unidades: el intercambio es válido (con o sin solape); dos viajes solapados con la MISMA unidad no", async () => {
    const swap = () => validar([cambio(101, { flotaVehiculoId: 31 }), cambio(102, { flotaVehiculoId: 30 })]);
    expect((await swap()).ok).toBe(true);
    planes[0].regreso = `${D0} 09:00:00`;
    expect((await swap()).ok).toBe(true);
    const r = await validar([cambio(101, { flotaVehiculoId: 31 }), cambio(102, { flotaVehiculoId: 31 })]);
    expect(r.ok).toBe(false);
    expect(fila(r, 101).errores[0].mensaje).toBe("La unidad C-31 queda asignada también en el viaje PLAN-102 de este mismo lote con horarios que se solapan.");
  });

  it("unidad heredada y Flota con la misma placa: solape bloqueado; ventanas secuenciales permitidas", async () => {
    planes[0].unidad_tms = 50; planes[0].flota = null; planes[0].unidad_placa = "P-123ABC";
    planes[0].regreso = `${D0} 09:00:00`;
    vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (_e: number, id: number) => ({ id, placa: id === 900 ? "P-123ABC" : `C-${id}` })) as never);
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [{ id: 900, placa: "P-123ABC", tipoUnidad: "Camion", estadoDisponibilidad: "disponible", viajeAbierto: null }] } as never);
    const cambios = () => validar([cambio(101), cambio(102, { flotaVehiculoId: 900 })]);
    const solapados = await cambios();
    expect(codigos(solapados, 102)).toEqual(["RECURSO_OCUPADO_LOTE"]);
    expect(fila(solapados, 101).estado).toBe("sin_cambios");
    planes[0].regreso = `${D0} 08:00:00`;
    expect((await cambios()).ok).toBe(true);
  });

  it("dos referencias heredadas con distinto TMS id y misma placa normalizada no se separan", async () => {
    planes[0].unidad_tms = 50; planes[0].flota = null; planes[0].unidad_placa = " p-123abc ";
    planes[1].unidad_tms = 51; planes[1].flota = null; planes[1].unidad_placa = "P-123ABC";
    planes[0].regreso = `${D0} 09:00:00`;
    vi.mocked(obtenerVehiculoAccesible).mockResolvedValue({ id: 900, placa: "P-123ABC" } as never);
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [{ id: 900, placa: "P-123ABC", tipoUnidad: "Camion", estadoDisponibilidad: "disponible", viajeAbierto: null }] } as never);
    const r = await validar([cambio(101), cambio(102, { flotaVehiculoId: 900 })]);
    expect(codigos(r, 102)).toEqual(["RECURSO_OCUPADO_LOTE"]);
  });

  it("unidad heredada sin contraparte Flota conserva fallback estable sin error artificial", async () => {
    planes[0].unidad_tms = 50; planes[0].flota = null; planes[0].unidad_placa = "P-999XYZ";
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [] } as never);
    const r = await validar([cambio(101)]);
    expect(r.ok).toBe(true);
    expect(fila(r, 101).estado).toBe("sin_cambios");
    expect(listarDisponibilidadVehiculos).toHaveBeenCalledWith(EMP);
    expect(execute).not.toHaveBeenCalled();
    for (const s of sqls) expect(s.trimStart()).toMatch(/^SELECT/i);
  });

  it("26) TC: el intercambio es válido; el mismo TC en dos viajes solapados no; sucesivos sí", async () => {
    const swap = () => validar([cambio(101, { tcVehiculoId: 41 }), cambio(102, { tcVehiculoId: 40 })]);
    expect((await swap()).ok).toBe(true);
    planes[0].regreso = `${D0} 09:00:00`;
    expect((await swap()).ok).toBe(true);
    const r = await validar([cambio(101, { tcVehiculoId: 41 }), cambio(102, { tcVehiculoId: 41 })]);
    expect(r.ok).toBe(false);
    expect(fila(r, 101).errores[0].mensaje).toContain("El TC TC-41 queda asignado");
    planes[0].regreso = `${D0} 08:00:00`; // 05-08 y 08-11: borde exacto
    expect((await validar([cambio(101, { tcVehiculoId: 41 }), cambio(102, { tcVehiculoId: 41 })])).ok).toBe(true);
  });

  it("27) cruce de medianoche: el mismo piloto en 24 22:00 -> 25 02:00 y en 25 01:00 choca; en 25 02:00 no", async () => {
    planes[0].hora = "22:00:00"; planes[0].regreso = `${D1} 02:00:00`;
    planes[1].fecha = D1; planes[1].hora = "01:00:00"; planes[1].regreso = `${D1} 04:00:00`;
    const dos = () => validar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 12 })]);
    expect((await dos()).ok).toBe(false);
    planes[1].hora = "02:00:00"; planes[1].regreso = `${D1} 05:00:00`;
    expect((await dos()).ok).toBe(true);
  });

  it("una fila con error (p. ej. inválida) aporta su asignación ACTUAL: no oculta conflictos de las demás", async () => {
    planes[1].estado = "Cerrado"; // B no editable: sigue con Juan 08-11
    planes[0].regreso = `${D0} 09:00:00`;
    const r = await validar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(codigos(r, 102)).toEqual(["ESTADO_NO_EDITABLE"]);
    expect(codigos(r, 101)).toContain("RECURSO_OCUPADO_LOTE"); // Juan sigue en B (05-09 vs 08-11)
  });
});

describe("solo lectura y contexto", () => {
  it("31) resolverSeleccionPersonal en modo lectura: nunca crea personal", async () => {
    await validar([cambio(101, { pilotoPersonalId: 12, auxiliarPersonalIds: [20, 21] })]);
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("32) el endpoint no ejecuta INSERT/UPDATE/DELETE, no abre transacción/conexión ni toma candados", async () => {
    await validar([cambio(101, { pilotoPersonalId: 11, flotaVehiculoId: 31, tcVehiculoId: 41 }), cambio(102, { pilotoPersonalId: 10, flotaVehiculoId: 30, tcVehiculoId: 40 })]);
    expect(execute).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
    expect(sqls.length).toBeGreaterThan(0);
    for (const s of sqls) {
      expect(s.trimStart(), s).toMatch(/^SELECT/i);
      expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|GET_LOCK|FOR UPDATE)\b/i);
    }
  });

  it("los planes se cargan con consultas bulk (no una por fila) y acotadas por empresa", async () => {
    await validar([cambio(101), cambio(102), cambio(103)]);
    expect(sqls.filter((s) => s.includes("LEFT JOIN tms_unidades u ON u.id = p.unidad_id"))).toHaveLength(1);
    expect(sqls.filter((s) => s.includes("FROM tms_plan_auxiliares pa"))).toHaveLength(1);
  });

  it("advertencias informativas se conservan (viaje en curso otro día, viático rechazado) y nunca bloquean", async () => {
    vi.mocked(listarDisponibilidadPersonal).mockResolvedValue(personal.map((p) => ({
      personalId: p.id, nombre: p.nombre, incidenciasBloqueantes: [], viajeActual: p.id === 12 ? { planId: 5 } : null, estadoDisponibilidad: "disponible",
      otrosPlanesDelDia: p.id === 12 ? [{ planId: 103, planCodigo: "PLAN-103" }, { planId: 777, planCodigo: "PLAN-777" }] : [], advertencias: [],
    })) as never);
    vi.mocked(listarViaticosRechazadosDelPlan).mockResolvedValue([{ personalId: 12, nombre: "Luis", tipo: "RECHAZADO", estadoViatico: "RECHAZADO", motivoRechazo: "Duplicado" }] as never);
    const r = await validar([cambio(101, { pilotoPersonalId: 12 }), cambio(103, { pilotoPersonalId: 10 })]);
    expect(fila(r, 101).estado).toBe("ok");
    expect(fila(r, 101).advertencias.map((a) => a.tipo)).toEqual(["viaje_actual_piloto", "otro_plan_dia_piloto", "viatico_rechazado_mismo_plan"]);
    expect(fila(r, 101).advertencias[1].mensaje).toContain("PLAN-777"); // PLAN-103 está en el lote: no se advierte contra él
  });
});

describe("solo lectura (guarda de código)", () => {
  it("el núcleo y la ruta (sin comentarios) no contienen escrituras, candados, transacciones ni módulos de escritura", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/lib/tms/edicion-rapida-validar.ts", "src/app/api/empresas/[slug]/tms/planes/edicion-rapida/validar/route.ts"]) {
      const codigo = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(codigo, f).not.toMatch(/(INSERT|UPDATE|DELETE)/);
      expect(codigo, f).not.toMatch(/execute\(|getPool|beginTransaction|GET_LOCK|FOR UPDATE|registrarAuditoria|sincronizarViaticosPlan|personalDesdeEmpleado|guardarAuxiliaresPlan|guardarParadasPlan/);
    }
  });
});
