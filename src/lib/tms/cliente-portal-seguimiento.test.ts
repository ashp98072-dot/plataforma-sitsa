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
    evidencias: 0,
    ...overrides,
  };
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
    ["EstadoInventado", "PROGRAMADO"],
  ] as const)("%s → %s", (real, esperado) => {
    expect(estadoViajePortal(real)).toBe(esperado);
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
    vi.mocked(query).mockResolvedValueOnce([filaPlan({ estado: "En ruta" })] as never);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([
      planParada({ id: 1, orden: 1, tipo: "Carga", evidencias: 1 }),
      planParada({ id: 2, orden: 2, tipo: "Entrega", evidencias: 0 }),
    ]);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan?.estadoPortal).toBe("EN_RUTA");
    expect(r?.plan?.paradas).toEqual([
      { id: 1, orden: 1, tipo: "Carga", lugarNombre: "Bodega PriceSmart", completada: true, cantidadEvidencias: 1 },
      { id: 2, orden: 2, tipo: "Entrega", lugarNombre: "Bodega PriceSmart", completada: false, cantidadEvidencias: 0 },
    ]);
  });

  it("plan sin piloto ni unidad asignados → pilotoNombre/unidadPlaca null (no rompe)", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    vi.mocked(query).mockResolvedValueOnce([filaPlan()] as never);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([]);
    const r = await obtenerSeguimientoSolicitudCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID);
    expect(r?.plan?.pilotoNombre).toBeNull();
    expect(r?.plan?.unidadPlaca).toBeNull();
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
    vi.mocked(query).mockResolvedValueOnce([filaPlan()] as never);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciasParadaCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 999);
    expect(r).toBeNull();
    // Solo la consulta del plan — nunca llegó a evidenciasDeParada.
    expect(vi.mocked(query).mock.calls).toHaveLength(1);
  });

  it("parada sin viajes vinculados (flota_viajes vacío) → []", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    vi.mocked(query)
      .mockResolvedValueOnce([filaPlan()] as never) // plan
      .mockResolvedValueOnce([] as never); // flota_viajes
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciasParadaCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1);
    expect(r).toEqual([]);
  });

  it("parada con N evidencias — resueltas vía flota_viajes.plan_id → flota_viaje_evidencias", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    vi.mocked(query)
      .mockResolvedValueOnce([filaPlan()] as never) // plan
      .mockResolvedValueOnce([{ id: 55 }] as never) // flota_viajes del plan
      .mockResolvedValueOnce([
        { id: 1, tipo: "producto", capturado_en: "2026-09-02 10:00:00", nombre_original: "foto1.jpg" },
        { id: 2, tipo: "producto", capturado_en: "2026-09-02 10:05:00", nombre_original: "foto2.jpg" },
      ] as never); // flota_viaje_evidencias
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1, evidencias: 2 })]);
    const r = await obtenerEvidenciasParadaCliente(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1);
    expect(r).toEqual([
      { id: 1, tipo: "producto", capturadoEn: "2026-09-02 10:00:00", nombreOriginal: "foto1.jpg" },
      { id: 2, tipo: "producto", capturadoEn: "2026-09-02 10:05:00", nombreOriginal: "foto2.jpg" },
    ]);
    const [sql, params] = vi.mocked(query).mock.calls[2];
    expect(String(sql)).toContain("flota_viaje_evidencias");
    expect(params).toEqual([EMPRESA_ID, 1, 55]);
  });
});

describe("obtenerEvidenciaClienteParaArchivo — nunca sirve un archivo sin revalidar TODA la cadena", () => {
  it("evidenciaId que no pertenece a la parada autorizada (aunque exista en otro plan) → null", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    vi.mocked(query)
      .mockResolvedValueOnce([filaPlan()] as never)
      .mockResolvedValueOnce([{ id: 55 }] as never)
      .mockResolvedValueOnce([
        { id: 1, tipo: "producto", capturado_en: null, nombre_original: "foto1.jpg" },
      ] as never);
    vi.mocked(listarParadasDelPlan).mockResolvedValue([planParada({ id: 1 })]);
    const r = await obtenerEvidenciaClienteParaArchivo(EMPRESA_ID, CLIENTE_ID, SOLICITUD_ID, 1, 999);
    expect(r).toBeNull();
    // Nunca llega a pedir la ruta del archivo para una evidencia no autorizada.
    expect(vi.mocked(query).mock.calls).toHaveLength(3);
  });

  it("evidencia válida → devuelve ruta relativa (nunca ruta absoluta) + nombre + mime", async () => {
    vi.mocked(obtenerSolicitudCliente).mockResolvedValue(solicitud());
    vi.mocked(query)
      .mockResolvedValueOnce([filaPlan()] as never)
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

  it("enriquece solicitudes PROGRAMADA con el estado/código LIVE del plan (una sola consulta batched)", async () => {
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
});
