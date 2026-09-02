import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDelPlan: vi.fn() }));
vi.mock("@/lib/tms/solicitudes-cliente", () => ({
  listarSolicitudesCliente: vi.fn(),
  obtenerSolicitudCliente: vi.fn(),
}));

import { query } from "@/lib/db";
import { listarParadasDelPlan, type PlanParada } from "@/lib/tms/paradas";
import {
  listarSolicitudesCliente,
  obtenerSolicitudCliente,
  type SolicitudClienteDetalle,
} from "@/lib/tms/solicitudes-cliente";
import {
  estadoViajePortal,
  listarViajesCliente,
  obtenerEvidenciaClienteParaArchivo,
  obtenerEvidenciasParadaCliente,
  obtenerSeguimientoSolicitudCliente,
  resumenSeguimientoCliente,
} from "./cliente-portal-seguimiento";

const EMPRESA_ID = 7;
const CLIENTE_ID = 30;
const SOLICITUD_ID = 500;
const PLAN_ID = 900;

function solicitud(overrides: Partial<SolicitudClienteDetalle> = {}): SolicitudClienteDetalle {
  return {
    id: SOLICITUD_ID,
    empresaId: EMPRESA_ID,
    clienteId: CLIENTE_ID,
    creadoPorUsuarioClienteId: 10,
    creadoPorNombre: "Contacto ACME",
    estado: "PROGRAMADA",
    fechaSolicitada: "2099-01-15",
    horaSolicitada: "08:00:00",
    referenciaCliente: "REF-1",
    observaciones: null,
    motivoRechazo: null,
    planId: PLAN_ID,
    version: 1,
    creadoEn: "2026-09-02 08:00:00",
    actualizadoEn: "2026-09-02 08:00:00",
    paradas: [],
    cantidadEntregas: 1,
    ...overrides,
  };
}

function filaPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    codigo: "PLAN-20990115-001",
    empresa_id: EMPRESA_ID,
    cliente_id: CLIENTE_ID,
    estado: "Programado",
    fecha_plan: "2099-01-15",
    hora_carga: "07:00:00",
    piloto_nombre: null,
    unidad_placa: null,
    ...overrides,
  };
}

function planParada(overrides: Partial<PlanParada> = {}): PlanParada {
  return {
    id: 1,
    plan_id: PLAN_ID,
    orden: 1,
    lugar_id: null,
    lugar_nombre: "Bodega PriceSmart",
    tipo: "Carga",
    requiere_evidencia: true,
    // AJUSTE PRE-MERGE PR #174 — este campo (suma legacy+vigente de
    // paradas.ts) YA NO se usa como cantidad visible del portal; se deja
    // deliberadamente distinto del conteo vigente esperado en los tests
    // de abajo para demostrar que el módulo ya NO lo reutiliza.
    evidencias: 99,
    ...overrides,
  };
}

/** Encadena los 2 mocks de query() que consume obtenerSeguimientoSolicitudCliente
 * cuando la solicitud tiene plan: 1) fila del plan, 2) conteo vigente por parada. */
function mockPlanYConteo(filaPlanRow: Record<string, unknown>, conteoRows: Record<string, unknown>[] = []) {
  vi.mocked(query)
    .mockResolvedValueOnce([filaPlanRow] as never) // plan
    .mockResolvedValueOnce(conteoRows as never); // conteoEvidenciasVigentesPorParada
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("estadoViajePortal — mapeo de estados reales, sin inventar estados nuevos", () => {
  it.each([
    ["Programado", "PROGRAMADO"],
    ["Cargado", "PROGRAMADO"],
    ["En ruta", "EN_RUTA"],
    ["Descargado", "FINALIZADO"],
    ["Cerrado", "FINALIZADO"],
    ["Cancelado", "CANCELADO"],
  ] as const)("%s → %s", (real, esperado) => {
    expect(estadoViajePortal(real)).toBe(esperado);
  });

  it("AJUSTE PRE-MERGE PR #174 (punto 3): estado real NO reconocido → DESCONOCIDO, nunca PROGRAMADO", () => {
    expect(estadoViajePortal("En aduana")).toBe("DESCONOCIDO");
    expect(estadoViajePortal("Retenido")).toBe("DESCONOCIDO");
    expect(estadoViajePortal("")).toBe("DESCONOCIDO");
  });
});

describe("obtenerSeguimientoSolicitudCliente — cadena de autorización completa", () => {
  it("solicitud inexistente/ajena (obtenerSolicitudCliente ya scoped devuelve null) → null", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(null);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("solicitud sin plan_id → { solicitud, plan: null }, sin consultar tms_planes_viaje", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud({ planId: null }));
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("plan encontrado pero de OTRA empresa/cliente (fuga vía FK) → null, defensa en profundidad", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    vi.mocked(query).mockResolvedValueOnce([filaPlan({ cliente_id: 999 })] as never);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r).toBeNull();
  });

  it("plan_id apunta a una fila que no existe (WHERE empresa_id no matchea) → null", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    vi.mocked(query).mockResolvedValueOnce([] as never);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r).toBeNull();
  });

  it("caso feliz: plan propio, con paradas — mapea estado/paradas/completada correctamente", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan({ estado: "En ruta" }), [{ parada_id: 1, n: 1 }]);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([
      planParada({ id: 1, orden: 1, tipo: "Carga" }),
      planParada({ id: 2, orden: 2, tipo: "Entrega" }),
    ]);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan?.estadoPortal).toBe("EN_RUTA");
    expect(r?.plan?.paradas).toEqual([
      { id: 1, orden: 1, tipo: "Carga", lugarNombre: "Bodega PriceSmart", completada: true, cantidadEvidencias: 1 },
      { id: 2, orden: 2, tipo: "Entrega", lugarNombre: "Bodega PriceSmart", completada: false, cantidadEvidencias: 0 },
    ]);
  });

  it("AJUSTE PRE-MERGE PR #174 (punto 1): foto reflejada en flota_viaje_evidencias Y tms_evidencias → cantidadEvidencias = 1, NUNCA 2", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    // El conteo vigente (batch, solo flota_viaje_evidencias) devuelve n=1
    // para la parada 1 — independientemente de que exista también un
    // espejo en tms_evidencias (esa tabla ya NO se consulta aquí).
    mockPlanYConteo(filaPlan(), [{ parada_id: 1, n: 1 }]);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1, evidencias: 2 })]);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan?.paradas[0].cantidadEvidencias).toBe(1);
    expect(r?.plan?.paradas[0].completada).toBe(true);
    // La consulta de conteo es SOLO contra flota_viaje_evidencias.
    const [sqlConteo] = vi.mocked(query).mock.calls[1];
    expect(String(sqlConteo)).toContain("flota_viaje_evidencias");
    expect(String(sqlConteo)).not.toContain("tms_evidencias");
  });

  it("conteo vigente batch: una sola consulta para TODAS las paradas del plan (sin N+1)", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan(), [
      { parada_id: 1, n: 3 },
      { parada_id: 2, n: 0 },
    ]);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([
      planParada({ id: 1 }),
      planParada({ id: 2 }),
      planParada({ id: 3 }), // sin fila en el conteo → 0
    ]);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan?.paradas.map((p) => p.cantidadEvidencias)).toEqual([3, 0, 0]);
    // Exactamente 2 llamadas a query(): fila del plan + conteo batch —
    // nunca una consulta adicional por parada.
    expect(vi.mocked(query).mock.calls).toHaveLength(2);
  });

  it("plan sin piloto ni unidad asignados → pilotoNombre/unidadPlaca null (no rompe)", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan());
    vi.mocked(listarParadasDelPlan).mockResolvedValue([]);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan?.pilotoNombre).toBeNull();
    expect(r?.plan?.unidadPlaca).toBeNull();
  });

  it("estado real no reconocido en el plan → estadoPortal DESCONOCIDO, estadoReal conserva el texto original", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan({ estado: "En aduana" }));
    vi.mocked(listarParadasDelPlan).mockResolvedValue([]);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan?.estadoPortal).toBe("DESCONOCIDO");
    expect(r?.plan?.estadoReal).toBe("En aduana");
  });
});

describe("obtenerEvidenciasParadaCliente — IDOR: nunca por paradaId suelto", () => {
  it("solicitud sin plan → null", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud({ planId: null }));
    const r = await obtenerEvidenciasParadaCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1);
    expect(r).toBeNull();
  });

  it("paradaId que NO pertenece al plan autorizado (de otro plan) → null, nunca consulta evidencias", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan());
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciasParadaCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 999);
    expect(r).toBeNull();
    // Solo las 2 consultas del seguimiento (plan + conteo) — nunca llegó
    // a evidenciasDeParada.
    expect(vi.mocked(query).mock.calls).toHaveLength(2);
  });

  it("parada sin viajes vinculados (flota_viajes vacío) → []", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan());
    vi.mocked(query).mockResolvedValueOnce([] as never); // flota_viajes
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciasParadaCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1);
    expect(r).toEqual([]);
  });

  it("parada con N evidencias — resueltas vía flota_viajes.plan_id → flota_viaje_evidencias", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan(), [{ parada_id: 1, n: 2 }]);
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 55 }] as never) // flota_viajes del plan
      .mockResolvedValueOnce([
        { id: 1, tipo: "producto", capturado_en: "2026-09-02 10:00:00", nombre_original: "foto1.jpg" },
        { id: 2, tipo: "producto", capturado_en: "2026-09-02 10:05:00", nombre_original: "foto2.jpg" },
      ] as never); // flota_viaje_evidencias
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciasParadaCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1);
    expect(r).toEqual([
      { id: 1, tipo: "producto", capturadoEn: "2026-09-02 10:00:00", nombreOriginal: "foto1.jpg" },
      { id: 2, tipo: "producto", capturadoEn: "2026-09-02 10:05:00", nombreOriginal: "foto2.jpg" },
    ]);
    const [sql, params] = vi.mocked(query).mock.calls[3];
    expect(String(sql)).toContain("flota_viaje_evidencias");
    expect(params).toEqual([EMPRESA_ID, 1, 55]);
  });
});

describe("obtenerEvidenciaClienteParaArchivo — nunca sirve un archivo sin revalidar TODA la cadena", () => {
  it("evidenciaId que no pertenece a la parada autorizada (aunque exista en otro plan) → null", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan(), [{ parada_id: 1, n: 1 }]);
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 55 }] as never)
      .mockResolvedValueOnce([
        { id: 1, tipo: "producto", capturado_en: null, nombre_original: "foto1.jpg" },
      ] as never);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciaClienteParaArchivo(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1, 999);
    expect(r).toBeNull();
    // Nunca llega a pedir la ruta del archivo para una evidencia no autorizada.
    expect(vi.mocked(query).mock.calls).toHaveLength(4);
  });

  it("evidencia válida → devuelve ruta relativa (nunca ruta absoluta) + nombre + mime", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    mockPlanYConteo(filaPlan(), [{ parada_id: 1, n: 1 }]);
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 55 }] as never)
      .mockResolvedValueOnce([
        { id: 1, tipo: "producto", capturado_en: null, nombre_original: "foto1.jpg" },
      ] as never)
      .mockResolvedValueOnce([
        { ruta_relativa: "flota/2026/09/foto1.jpg", nombre_original: "foto1.jpg", mime: "image/jpeg" },
      ] as never);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciaClienteParaArchivo(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1, 1);
    expect(r).toEqual({
      rutaRelativa: "flota/2026/09/foto1.jpg",
      nombreOriginal: "foto1.jpg",
      mime: "image/jpeg",
    });
  });
});

describe("listarViajesCliente — extiende listarSolicitudesCliente, NO es una segunda fuente de verdad", () => {
  it("sin solicitudes con plan → no consulta tms_planes_viaje", async () => {
    vi.mocked(listarSolicitudesCliente).mockResolvedValue([
      {
        id: 1,
        estado: "SOLICITADA",
        fechaSolicitada: "2099-01-15",
        horaSolicitada: null,
        referenciaCliente: null,
        cantidadEntregas: 1,
        planId: null,
        creadoEn: "2026-09-02 08:00:00",
      },
    ]);
    const r = await listarViajesCliente(EMPRESA_ID, CLIENTE_ID);
    expect(r[0]).toMatchObject({ solicitudId: 1, planCodigo: null, estadoViaje: null });
    expect(query).not.toHaveBeenCalled();
  });

  it("enriquece solicitudes PROGRAMADA con el estado/código LIVE del plan (una sola consulta batched, scoped por empresa+cliente)", async () => {
    vi.mocked(listarSolicitudesCliente).mockResolvedValue([
      {
        id: 1,
        estado: "PROGRAMADA",
        fechaSolicitada: "2099-01-15",
        horaSolicitada: null,
        referenciaCliente: null,
        cantidadEntregas: 1,
        planId: PLAN_ID,
        creadoEn: "2026-09-02 08:00:00",
      },
    ]);
    vi.mocked(query).mockResolvedValueOnce([
      { id: PLAN_ID, codigo: "PLAN-20990115-001", estado: "En ruta" },
    ] as never);
    const r = await listarViajesCliente(EMPRESA_ID, CLIENTE_ID);
    expect(r[0]).toMatchObject({
      planCodigo: "PLAN-20990115-001",
      estadoViaje: "EN_RUTA",
    });
    expect(vi.mocked(query).mock.calls).toHaveLength(1);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("cliente_id = ?");
    expect(params).toEqual([EMPRESA_ID, CLIENTE_ID, PLAN_ID]);
  });

  it("AJUSTE PRE-MERGE PR #174 (punto 2): planId de una solicitud scoped del cliente A que (por dato inconsistente) apunta a un plan de OTRO cliente en la MISMA empresa → NO enriquece, planCodigo/estadoViaje quedan null", async () => {
    vi.mocked(listarSolicitudesCliente).mockResolvedValue([
      {
        id: 1,
        estado: "PROGRAMADA",
        fechaSolicitada: "2099-01-15",
        horaSolicitada: null,
        referenciaCliente: null,
        cantidadEntregas: 1,
        planId: PLAN_ID,
        creadoEn: "2026-09-02 08:00:00",
      },
    ]);
    // Simula lo que MySQL devolvería con el filtro `cliente_id = ?` real:
    // el plan #900 existe, pero es de otro cliente → 0 filas.
    vi.mocked(query).mockResolvedValueOnce([] as never);
    const r = await listarViajesCliente(EMPRESA_ID, CLIENTE_ID);
    expect(r[0]).toMatchObject({ planId: PLAN_ID, planCodigo: null, estadoViaje: null });
  });
});

describe("resumenSeguimientoCliente — bucketing sin doble conteo", () => {
  it("distribuye cada viaje en exactamente un bucket", async () => {
    vi.mocked(listarSolicitudesCliente).mockResolvedValue([
      { id: 1, estado: "SOLICITADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: null, creadoEn: "x" },
      { id: 2, estado: "EN_REVISION", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: null, creadoEn: "x" },
      { id: 3, estado: "RECHAZADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: null, creadoEn: "x" },
      { id: 4, estado: "PROGRAMADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: 901, creadoEn: "x" },
      { id: 5, estado: "PROGRAMADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: 902, creadoEn: "x" },
      { id: 6, estado: "PROGRAMADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: 903, creadoEn: "x" },
    ]);
    vi.mocked(query).mockResolvedValueOnce([
      { id: 901, codigo: "P1", estado: "Programado" },
      { id: 902, codigo: "P2", estado: "En ruta" },
      { id: 903, codigo: "P3", estado: "Cerrado" },
    ] as never);
    const r = await resumenSeguimientoCliente(EMPRESA_ID, CLIENTE_ID);
    expect(r).toEqual({
      pendientes: 2,
      viajesProgramados: 1,
      viajesEnRuta: 1,
      viajesFinalizados: 1,
      rechazadasCanceladas: 1,
      total: 6,
    });
  });

  it("AJUSTE PRE-MERGE PR #174 (punto 4): 1 plan CANCELADO → viajesFinalizados = 0, rechazadasCanceladas += 1", async () => {
    vi.mocked(listarSolicitudesCliente).mockResolvedValue([
      { id: 1, estado: "PROGRAMADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: 901, creadoEn: "x" },
    ]);
    vi.mocked(query).mockResolvedValueOnce([
      { id: 901, codigo: "P1", estado: "Cancelado" },
    ] as never);
    const r = await resumenSeguimientoCliente(EMPRESA_ID, CLIENTE_ID);
    expect(r.viajesFinalizados).toBe(0);
    expect(r.rechazadasCanceladas).toBe(1);
    expect(r.total).toBe(1);
  });

  it("ÚLTIMO AJUSTE PRE-MERGE PR #174 (punto 1.A): 1 solicitud PROGRAMADA con estadoViaje DESCONOCIDO → viajesProgramados = 0, no cae en ningún bucket de viaje", async () => {
    vi.mocked(listarSolicitudesCliente).mockResolvedValue([
      { id: 1, estado: "PROGRAMADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: 901, creadoEn: "x" },
    ]);
    // Estado real no reconocido -> estadoViajePortal() lo mapea a DESCONOCIDO.
    vi.mocked(query).mockResolvedValueOnce([
      { id: 901, codigo: "P1", estado: "En aduana" },
    ] as never);
    const r = await resumenSeguimientoCliente(EMPRESA_ID, CLIENTE_ID);
    expect(r.viajesProgramados).toBe(0);
    expect(r.viajesEnRuta).toBe(0);
    expect(r.viajesFinalizados).toBe(0);
    expect(r.rechazadasCanceladas).toBe(0);
    expect(r.total).toBe(1);
  });

  it("ÚLTIMO AJUSTE PRE-MERGE PR #174 (punto 1.B): 1 solicitud PROGRAMADA con estadoViaje null (planId no enriquecido) → viajesProgramados = 0", async () => {
    vi.mocked(listarSolicitudesCliente).mockResolvedValue([
      { id: 1, estado: "PROGRAMADA", fechaSolicitada: "2099-01-01", horaSolicitada: null, referenciaCliente: null, cantidadEntregas: 1, planId: 901, creadoEn: "x" },
    ]);
    // Simula la defensa en profundidad del punto 2 (planId inconsistente
    // filtrado por cliente_id = ?): 0 filas -> estadoViaje queda null.
    vi.mocked(query).mockResolvedValueOnce([] as never);
    const r = await resumenSeguimientoCliente(EMPRESA_ID, CLIENTE_ID);
    expect(r.viajesProgramados).toBe(0);
    expect(r.viajesEnRuta).toBe(0);
    expect(r.viajesFinalizados).toBe(0);
    expect(r.rechazadasCanceladas).toBe(0);
    expect(r.total).toBe(1);
  });
});
