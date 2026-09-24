import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * PR-355 — Edición rápida: TARIFA del catálogo y VIÁTICOS. BD simulada mínima (planes, auxiliares, personal, viáticos,
 * tarifas por ruta); el núcleo de validación (evaluarEdicionRapida) y el guardado (guardarEdicionRapida) son los de
 * producción. Sin BD real: no se ejecuta SQL contra ninguna base.
 */
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn() }));
vi.mock("@/lib/tms/plan-comunes", () => ({ guardarAuxiliaresPlan: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(async () => []),
  personalRecienAsignadoDelPlan: vi.fn(() => []),
  sincronizarViaticosPlan: vi.fn(),
}));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("@/lib/tms/tc-plan", () => ({ resolverTcInterno: vi.fn() }));
vi.mock("@/lib/tms/ruta-tarifas", () => ({ tarifaParaSnapshot: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { hoyLocal } from "@/lib/rrhh/dates";
import { validarPersonalId } from "@/lib/tms/personal-resolucion";
import { tarifaParaSnapshot } from "@/lib/tms/ruta-tarifas";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { validarEdicionRapidaSchema } from "./edicion-rapida-schema";
import { validarEdicionRapida } from "./edicion-rapida-validar";
import { guardarEdicionRapida } from "./edicion-rapida-guardar";

const EMP = 7;
const sumarDias = (fecha: string, n: number) => { const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const HOY = hoyLocal();
const D0 = sumarDias(HOY, 10);

type Via = { plan_id: number; personal_id: number; monto_asignado: number; monto_sugerido: number; estado: string };
type Plan = {
  id: number; empresa_id: number; estado: string; tipo_viaje: string; piloto_id: number | null; aux: number[];
  ruta_id: number | null; tarifa_id: number | null; tarifa_comercial: number | null;
};
let planes: Plan[];
let viaticos: Via[];
let updates: { sql: string; params: unknown[] }[];
let eventos: string[];

const plan = (id: number, over: Partial<Plan> = {}): Plan => ({
  id, empresa_id: EMP, estado: "Programado", tipo_viaje: "Propio", piloto_id: 10, aux: [20], ruta_id: 5, tarifa_id: null, tarifa_comercial: null, ...over,
});
const TARIFA_A = { id: 61, nombre: "Ruta corta", monto: 1500, moneda: "GTQ" };

const PERSONAL = [
  { id: 10, nombre: "Carlos", tipo: "Piloto" }, { id: 11, nombre: "Juan", tipo: "Piloto" },
  { id: 20, nombre: "Pedro", tipo: "Auxiliar" }, { id: 21, nombre: "Mario", tipo: "Auxiliar" },
];

function responder(s: string, params: unknown[]): unknown[] {
  const empresa = Number(params[0]);
  if (s.includes("FROM tms_planes_viaje p") && s.includes("LEFT JOIN tms_unidades u ON u.id = p.unidad_id") && s.includes("p.id IN")) {
    const ids = params.slice(1) as number[];
    return planes.filter((p) => p.empresa_id === empresa && ids.includes(p.id)).map((p) => ({
      id: p.id, codigo: `PLAN-${p.id}`, estado: p.estado, fecha_plan: D0, hora_carga: "05:00:00", regreso_estimado: `${D0} 08:00:00`, tipo_viaje: p.tipo_viaje,
      piloto_id: p.piloto_id, unidad_id: null, unidad_placa: null, flota_vehiculo_id: null, tc_vehiculo_id: null,
      piloto_nombre: PERSONAL.find((x) => x.id === p.piloto_id)?.nombre ?? null, ruta_id: p.ruta_id, tarifa_id: p.tarifa_id, tarifa_comercial: p.tarifa_comercial, pendiente_cierre: 0,
    }));
  }
  if (s.includes("FROM tms_plan_auxiliares pa")) {
    const ids = params.slice(1) as number[];
    return planes.filter((p) => ids.includes(p.id)).flatMap((p) => p.aux.map((a, i) => ({ plan_id: p.id, personal_id: a, nombre: PERSONAL.find((x) => x.id === a)?.nombre, orden: i + 1 })));
  }
  if (s.includes("FROM tms_viaticos") && s.includes("monto_asignado")) {
    const ids = params.slice(1) as number[];
    return viaticos.filter((v) => ids.includes(v.plan_id));
  }
  if (s.startsWith("SELECT id, id_empleado, nombre FROM tms_personal WHERE empresa_id")) {
    const ids = params.slice(1) as number[];
    return PERSONAL.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, id_empleado: 100 + p.id, nombre: p.nombre }));
  }
  return [];
}

function crearConexion() {
  return {
    beginTransaction: vi.fn(async () => { eventos.push("begin"); }),
    commit: vi.fn(async () => { eventos.push("commit"); }),
    rollback: vi.fn(async () => { eventos.push("rollback"); }),
    release: vi.fn(async () => { eventos.push("release"); }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      if (s.includes("GET_LOCK")) return [[{ l: 1 }]];
      if (s.includes("RELEASE_LOCK")) return [[{ l: 1 }]];
      if (s.includes("ORDER BY id FOR UPDATE")) return [[]];
      return [responder(s, params)];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      if (!s.startsWith("UPDATE tms_planes_viaje SET")) throw new Error(`SQL de escritura inesperado: ${s.slice(0, 60)}`);
      updates.push({ sql: s, params });
      eventos.push("update");
      return [{ affectedRows: 1 }];
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  eventos = [];
  updates = [];
  viaticos = [];
  planes = [plan(101), plan(102, { piloto_id: 11, aux: [] })];
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => responder(String(sql), params)) as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => crearConexion() } as never);
  vi.mocked(validarPersonalId).mockImplementation((async (_e: number, id: number, tipo: string) => {
    const p = PERSONAL.find((x) => x.id === id && x.tipo === tipo);
    return p ? { id: p.id, nombre: p.nombre } : null;
  }) as never);
  vi.mocked(listarDisponibilidadPersonal).mockImplementation((async () => PERSONAL.map((p) => ({
    personalId: p.id, nombre: p.nombre, incidenciasBloqueantes: [], viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [],
  }))) as never);
  vi.mocked(tarifaParaSnapshot).mockImplementation((async (_e: number, ruta: number, id: number) => (ruta === 5 && id === TARIFA_A.id ? TARIFA_A : null)) as never);
});

type Nuevo = Record<string, unknown>;
/** Fila del payload: esperado = lo que la BD tiene (incluida tarifa/viáticos si `conExtras`) + `nuevo` con los recursos actuales + cambios. */
function cambio(planId: number, nuevo: Nuevo = {}, opciones: { conExtras?: boolean; esperado?: Record<string, unknown> } = {}) {
  const conExtras = opciones.conExtras ?? true;
  const p = planes.find((x) => x.id === planId)!;
  const extras = conExtras ? {
    tarifaId: p.tarifa_id, tarifaComercial: p.tarifa_comercial,
    viaticos: viaticos.filter((v) => v.plan_id === planId).map((v) => ({ personalId: v.personal_id, montoAsignado: v.monto_asignado, estado: v.estado })),
  } : {};
  return {
    planId,
    esperado: { estado: p.estado, fechaPlan: D0, horaCarga: "05:00", regresoEstimado: `${D0}T08:00`, pilotoPersonalId: p.piloto_id, auxiliarPersonalIds: p.aux, flotaVehiculoId: null, tcVehiculoId: null, ...extras, ...(opciones.esperado ?? {}) },
    nuevo: { pilotoPersonalId: p.piloto_id, auxiliarPersonalIds: p.aux, flotaVehiculoId: null, tcVehiculoId: null, ...nuevo },
  };
}
const lote = (cambios: ReturnType<typeof cambio>[], motivoCambio = "Cambio de prueba") => validarEdicionRapidaSchema.parse({ motivoCambio, cambios });
const validar = (cambios: ReturnType<typeof cambio>[], motivo?: string) => validarEdicionRapida(EMP, lote(cambios, motivo));
const guardar = (cambios: ReturnType<typeof cambio>[], motivo?: string) => guardarEdicionRapida(EMP, "ana", lote(cambios, motivo));
const codigos = (r: Awaited<ReturnType<typeof validar>>, planId: number) => r.filas.find((f) => f.planId === planId)!.errores.map((e) => e.codigo);

describe("Edición rápida — TARIFA (validar)", () => {
  it("1) asigna una tarifa vigente de la ruta del viaje", async () => {
    const r = await validar([cambio(101, { tarifaId: 61 })]);
    expect(r.ok).toBe(true);
    expect(r.filas[0].estado).toBe("ok");
    expect(tarifaParaSnapshot).toHaveBeenCalledWith(EMP, 5, 61, undefined);
  });

  it("2) una tarifa de OTRA ruta se rechaza (TARIFA_INVALIDA) y nunca se inventa", async () => {
    const r = await validar([cambio(101, { tarifaId: 999 })]);
    expect(codigos(r, 101)).toContain("TARIFA_INVALIDA");
  });

  it("3) la empresa sale de la sesión: la tarifa se resuelve con la empresa del llamador (aislamiento multiempresa)", async () => {
    await validarEdicionRapida(EMP, lote([cambio(101, { tarifaId: 61 })]));
    expect(vi.mocked(tarifaParaSnapshot).mock.calls.every((c) => c[0] === EMP)).toBe(true);
    // un plan de otra empresa no existe para esta sesión
    planes.push(plan(300, { empresa_id: 99 }));
    const r = await validar([cambio(300, { tarifaId: 61 })]);
    expect(codigos(r, 300)).toContain("PLAN_NO_ENCONTRADO");
  });

  it("4) quitar la tarifa (sin tarifa) es un cambio válido", async () => {
    planes[0].tarifa_id = 61; planes[0].tarifa_comercial = 1500;
    const r = await validar([cambio(101, { tarifaId: null })]);
    expect(r.filas[0].estado).toBe("ok");
  });

  it("5) un viaje sin ruta no puede tomar una tarifa del catálogo", async () => {
    planes[0].ruta_id = null;
    const r = await validar([cambio(101, { tarifaId: 61 })]);
    expect(codigos(r, 101)).toContain("TARIFA_INVALIDA");
  });

  it("6) la misma tarifa que ya tiene el viaje no es un cambio", async () => {
    planes[0].tarifa_id = 61; planes[0].tarifa_comercial = 1500;
    const r = await validar([cambio(101, { tarifaId: 61 })]);
    expect(r.filas[0].estado).toBe("sin_cambios");
    expect(tarifaParaSnapshot).not.toHaveBeenCalled();
  });

  it("7) estados no editables: En ruta (sin cierre pendiente), Cerrado y Cancelado bloquean la tarifa", async () => {
    for (const estado of ["En ruta", "Cerrado", "Cancelado"]) {
      planes[0].estado = estado;
      const r = await validar([cambio(101, { tarifaId: 61 })]);
      expect(codigos(r, 101), estado).toContain("ESTADO_NO_EDITABLE");
    }
  });

  it("8) concurrencia: si la tarifa del viaje cambió desde que se cargó, PLAN_DESACTUALIZADO", async () => {
    planes[0].tarifa_id = 62; planes[0].tarifa_comercial = 900; // la BD ya cambió
    const r = await validar([cambio(101, { tarifaId: 61 }, { esperado: { tarifaId: null, tarifaComercial: null } })]);
    expect(codigos(r, 101)).toContain("PLAN_DESACTUALIZADO");
    // solo cambió el monto comercial: también es desactualizado
    planes[0].tarifa_id = null; planes[0].tarifa_comercial = 900;
    const r2 = await validar([cambio(101, { tarifaId: 61 }, { esperado: { tarifaId: null, tarifaComercial: 1000 } })]);
    expect(codigos(r2, 101)).toContain("PLAN_DESACTUALIZADO");
  });

  it("9) Tercerizado: la tarifa SÍ se edita; recursos internos y viáticos no", async () => {
    planes[0].tipo_viaje = "Tercerizado"; planes[0].aux = [];
    expect((await validar([cambio(101, { tarifaId: 61 })])).ok).toBe(true);
    const r = await validar([cambio(101, { pilotoPersonalId: 11 })]);
    expect(codigos(r, 101)).toContain("TERCERIZADO_SIN_RECURSOS_INTERNOS");
  });

  it("10) contrato anterior (sin tarifa ni viáticos): sigue funcionando y no toca tarifa", async () => {
    const r = await validar([cambio(101, { pilotoPersonalId: 11 }, { conExtras: false })]);
    expect(r.ok).toBe(true);
    expect(tarifaParaSnapshot).not.toHaveBeenCalled();
  });

  it("11) esquema: cambiar la tarifa exige enviar la tarifa esperada; el cuerpo sigue siendo estricto", () => {
    const base = cambio(101, { tarifaId: 61 }, { conExtras: false });
    expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "x", cambios: [base] }).success).toBe(false);
    expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "x", cambios: [{ ...base, esperado: { ...base.esperado, tarifaId: null, tarifaComercial: null } }] }).success).toBe(true);
    expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "x", empresaId: 9, cambios: [base] }).success).toBe(false);
    expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "x", cambios: [{ ...base, nuevo: { ...base.nuevo, tarifaMonto: 5 } }] }).success).toBe(false);
  });

  it("12) validar es de solo lectura: no abre conexión ni escribe", async () => {
    await validar([cambio(101, { tarifaId: 61 })]);
    expect(getPool).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

describe("Edición rápida — TARIFA (guardar)", () => {
  it("13) asignar: UPDATE con tarifa_id + snapshots de nombre/monto/moneda y tarifa_comercial = monto de la tarifa", async () => {
    const r = await guardar([cambio(101, { tarifaId: 61 })]);
    expect(r).toMatchObject({ ok: true, guardados: 1 });
    const u = updates[0];
    expect(u.sql).toContain("tarifa_id = ?");
    expect(u.sql).toContain("tarifa_nombre_historico = ?");
    expect(u.sql).toContain("tarifa_monto_historico = ?");
    expect(u.sql).toContain("tarifa_moneda_historico = ?");
    expect(u.sql).toContain("tarifa_comercial = ?");
    expect(u.params.slice(0, 5)).toEqual([61, "Ruta corta", 1500, "GTQ", 1500]);
    expect(u.params.slice(5)).toEqual([101, EMP, "Programado"]); // acotado por empresa y con guarda de estado
    expect(u.sql).not.toMatch(/piloto_id|unidad_id|tc_vehiculo_id/); // solo lo que cambió
  });

  it("14) quitar: limpia el snapshot del catálogo y NO toca tarifa_comercial (monto manual)", async () => {
    planes[0].tarifa_id = 61; planes[0].tarifa_comercial = 1500;
    await guardar([cambio(101, { tarifaId: null })]);
    const u = updates[0];
    expect(u.sql).toContain("tarifa_id = NULL");
    expect(u.sql).toContain("tarifa_nombre_historico = NULL");
    expect(u.sql).toContain("tarifa_monto_historico = NULL");
    expect(u.sql).toContain("tarifa_moneda_historico = NULL");
    expect(u.sql).not.toContain("tarifa_comercial");
  });

  it("15) atómico: si UNA fila del lote es inválida no se escribe NINGUNA (rollback, sin UPDATE)", async () => {
    const r = await guardar([cambio(101, { tarifaId: 61 }), cambio(102, { tarifaId: 999 })]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(updates).toHaveLength(0);
    expect(eventos).toContain("rollback");
    expect(eventos).not.toContain("commit");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("16) auditoría por plan modificado con tarifa antes → después y motivo, en la misma transacción", async () => {
    await guardar([cambio(101, { tarifaId: 61 })], "Se acordó la tarifa");
    const detalle = vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle as string;
    expect(detalle).toContain("Plan #101");
    expect(detalle).toContain("tarifa sin tarifa → Ruta corta #61 (1500 GTQ)");
    expect(detalle).toContain("motivo: Se acordó la tarifa");
    expect(eventos.indexOf("commit")).toBeGreaterThan(eventos.indexOf("update"));
  });

  it("17) el flujo 'copiar sin tarifa → asignar tarifa en Edición rápida → validar → guardar' funciona", async () => {
    // Viaje recién copiado sin tarifa: tarifa_id / tarifa_comercial NULL
    expect(planes[0]).toMatchObject({ tarifa_id: null, tarifa_comercial: null });
    expect((await validar([cambio(101, { tarifaId: 61 })])).ok).toBe(true);
    expect(await guardar([cambio(101, { tarifaId: 61 })])).toMatchObject({ ok: true, guardados: 1 });
    expect(updates[0].params.slice(0, 5)).toEqual([61, "Ruta corta", 1500, "GTQ", 1500]);
  });

  it("18) nada de DDL/DML fuera de UPDATE tms_planes_viaje en esta operación de tarifa", async () => {
    const fuente = readFileSync("src/lib/tms/edicion-rapida-guardar.ts", "utf8");
    expect(fuente).not.toMatch(/\b(DROP|TRUNCATE|ALTER)\s+TABLE\b/i);
    expect(fuente).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe("Edición rápida — VIÁTICOS", () => {
  beforeEach(() => {
    viaticos = [
      { plan_id: 101, personal_id: 10, monto_asignado: 200, monto_sugerido: 200, estado: "PROGRAMADO" },
      { plan_id: 101, personal_id: 20, monto_asignado: 150, monto_sugerido: 150, estado: "PROGRAMADO" },
    ];
  });
  const via = (personalId: number, montoAsignado: number) => ({ personalId, montoAsignado });

  it("1) edita el monto del viático de un piloto/auxiliar del estado final", async () => {
    const r = await validar([cambio(101, { viaticos: [via(10, 250)] })]);
    expect(r.ok).toBe(true);
    expect(r.filas[0].estado).toBe("ok");
  });

  it("2) el monto sin cambio real no es un cambio", async () => {
    const r = await validar([cambio(101, { viaticos: [via(10, 200)] })]);
    expect(r.filas[0].estado).toBe("sin_cambios");
  });

  it("3) monto 0 es válido (no hay concepto separado de 'sin viático')", async () => {
    expect((await validar([cambio(101, { viaticos: [via(20, 0)] })])).ok).toBe(true);
  });

  it("4) esquema: monto negativo, más de 2 decimales, NaN y personalId repetido se rechazan", () => {
    const ok = (viaticos: unknown) => validarEdicionRapidaSchema.safeParse({ motivoCambio: "x", cambios: [cambio(101, { viaticos })] }).success;
    expect(ok([via(10, 250)])).toBe(true);
    expect(ok([via(10, -1)])).toBe(false);
    expect(ok([via(10, 10.005)])).toBe(false);
    expect(ok([via(10, Number.NaN)])).toBe(false);
    expect(ok([via(10, 1), via(10, 2)])).toBe(false);
    expect(ok([{ personalId: 10, montoAsignado: 5, extra: 1 }])).toBe(false);
  });

  it("5) el motivo es obligatorio cuando cambian viáticos", async () => {
    const r = await validarEdicionRapida(EMP, validarEdicionRapidaSchema.parse({ cambios: [cambio(101, { viaticos: [via(10, 250)] })] }));
    expect(codigos(r, 101)).toContain("MOTIVO_REQUERIDO");
  });

  it("6) no se edita el viático de quien NO queda en el viaje (VIATICO_INVALIDO)", async () => {
    const r = await validar([cambio(101, { viaticos: [via(21, 100)] })]);
    expect(codigos(r, 101)).toContain("VIATICO_INVALIDO");
  });

  it("7) un viático ya procesado (no PROGRAMADO) no se modifica: error explícito, nunca se ignora en silencio", async () => {
    viaticos[0].estado = "AUTORIZADO";
    const r = await validar([cambio(101, { viaticos: [via(10, 999)] })]);
    expect(codigos(r, 101)).toContain("VIATICO_PROCESADO");
  });

  it("8) concurrencia: si los viáticos cambiaron desde que se cargaron, PLAN_DESACTUALIZADO", async () => {
    const esperado = { viaticos: [{ personalId: 10, montoAsignado: 200, estado: "PROGRAMADO" }, { personalId: 20, montoAsignado: 100, estado: "PROGRAMADO" }] };
    const r = await validar([cambio(101, { viaticos: [via(10, 250)] }, { esperado })]);
    expect(codigos(r, 101)).toContain("PLAN_DESACTUALIZADO");
    // un viático que pasó a AUTORIZADO desde entonces también es desactualizado
    viaticos[0].estado = "AUTORIZADO";
    const r2 = await validar([cambio(101, { viaticos: [via(20, 300)] }, { esperado: { viaticos: [{ personalId: 10, montoAsignado: 200, estado: "PROGRAMADO" }, { personalId: 20, montoAsignado: 150, estado: "PROGRAMADO" }] } })]);
    expect(codigos(r2, 101)).toContain("PLAN_DESACTUALIZADO");
  });

  it("9) esquema: editar viáticos exige enviar los viáticos esperados", () => {
    const sin = cambio(101, { viaticos: [via(10, 250)] }, { conExtras: false });
    expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "x", cambios: [sin] }).success).toBe(false);
  });

  it("10) Tercerizado no admite viáticos", async () => {
    planes[0].tipo_viaje = "Tercerizado";
    const r = await validar([cambio(101, { viaticos: [via(10, 250)] })]);
    expect(codigos(r, 101)).toContain("TERCERIZADO_SIN_RECURSOS_INTERNOS");
  });

  it("11) guardar: el monto editado viaja como override a sincronizarViaticosPlan (ids de tms_personal) dentro de la transacción", async () => {
    const r = await guardar([cambio(101, { viaticos: [via(10, 250)] })], "Viático especial");
    expect(r).toMatchObject({ ok: true, guardados: 1 });
    const [empresa, planId, asignacion, conn, overrides] = vi.mocked(sincronizarViaticosPlan).mock.calls[0];
    expect([empresa, planId]).toEqual([EMP, 101]);
    expect(asignacion).toEqual({ piloto: 10, auxiliares: [20] });
    expect(conn).toBeDefined();
    expect(overrides).toEqual([{ personalId: 10, montoAsignado: 250 }]);
    expect(updates).toHaveLength(0); // solo viáticos: no se reescribe el viaje
  });

  it("12) cambiar piloto SIN editar montos sincroniza viáticos con overrides vacíos (monto sugerido del catálogo)", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 11 })], "Cambio de piloto");
    const [, , asignacion, , overrides] = vi.mocked(sincronizarViaticosPlan).mock.calls[0];
    expect(asignacion).toEqual({ piloto: 11, auxiliares: [20] });
    expect(overrides).toEqual([]);
  });

  it("13) cambiar piloto + editar el viático del NUEVO piloto en el mismo lote", async () => {
    const r = await guardar([cambio(101, { pilotoPersonalId: 11, viaticos: [via(11, 300)] })], "Cambio y viático");
    expect(r).toMatchObject({ ok: true });
    const [, , asignacion, , overrides] = vi.mocked(sincronizarViaticosPlan).mock.calls[0];
    expect(asignacion).toMatchObject({ piloto: 11 });
    expect(overrides).toEqual([{ personalId: 11, montoAsignado: 300 }]);
  });

  it("14) atómico: un viático inválido en una fila impide guardar TODO el lote", async () => {
    viaticos.push({ plan_id: 102, personal_id: 11, monto_asignado: 100, monto_sugerido: 100, estado: "ENTREGADO" });
    const r = await guardar([cambio(101, { viaticos: [via(10, 250)] }), cambio(102, { viaticos: [via(11, 500)] })]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(sincronizarViaticosPlan).not.toHaveBeenCalled();
    expect(eventos).toContain("rollback");
    expect(eventos).not.toContain("commit");
  });

  it("15) auditoría con viático antes → después por persona", async () => {
    await guardar([cambio(101, { viaticos: [via(10, 250)] })], "Viático especial");
    const detalle = vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle as string;
    expect(detalle).toContain("viáticos Carlos 200 → 250");
    expect(detalle).toContain("motivo: Viático especial");
  });

  it("16) tarifa + viáticos + piloto en el mismo viaje: un solo UPDATE y una sola auditoría", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 11, tarifaId: 61, viaticos: [via(11, 300)] })], "Todo junto");
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("piloto_id = ?");
    expect(updates[0].sql).toContain("tarifa_id = ?");
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(1);
  });
});
