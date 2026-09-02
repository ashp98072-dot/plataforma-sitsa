import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  requireTenantProgramacion: vi.fn(),
  requireTenantProgramacionOTms: vi.fn(),
}));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({
  listarDisponibilidadVehiculos: vi.fn(() =>
    Promise.resolve({
      vehiculos: [],
      resumen: { total: 0, disponibles: 0, enTaller: 0, enRuta: 0, inactivos: 0, propios: 0, compartidos: 0 },
    }),
  ),
  placasDisponiblesParaPlan: vi.fn(() => []),
}));
vi.mock("@/lib/tms/codigo-plan", () => ({
  asegurarCodigoPlanUnico: vi.fn(),
  generarCodigoPlan: vi.fn(),
}));
vi.mock("@/lib/tms/paradas", () => ({
  guardarParadasPlan: vi.fn(),
  listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({
  listarDisponibilidadPersonal: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(),
  personalRecienAsignadoDelPlan: vi.fn(),
  sincronizarViaticosPlan: vi.fn(),
}));
vi.mock("@/lib/tms/disponibilidad-traslapes", () => ({
  ESTADOS_QUE_RESERVAN_RECURSOS: new Set(),
  finViajeDesdeInput: vi.fn(),
  inicioViaje: vi.fn(),
  mensajeConflicto: vi.fn(),
  primerConflictoTraslape: vi.fn(),
}));

import { query } from "@/lib/db";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarParadasDePlanes } from "@/lib/tms/paradas";
import { GET } from "./route";

const EMPRESA_ID = 7;
const PLAN_ID = 31;
const ctx = { params: Promise.resolve({ slug: "sitsa" }) };

function req(qs = "") {
  return new Request(`http://localhost/api/empresas/sitsa/tms/planes${qs}`);
}

function filaPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    codigo: "PLAN-20260901-005",
    fecha_plan: "2026-09-01",
    hora_carga: "07:00:00",
    estado: "Programado",
    cerrado_por: null,
    cerrado_en: null,
    pendiente_cierre: 0,
    atrasado: 0,
    tipo_traslado: null,
    notas: null,
    regreso_estimado: null,
    tarifa_comercial: null,
    referencia_cliente: null,
    ruta_id: null,
    ruta_codigo_historico: null,
    lugar_descarga_historico: null,
    contacto_nombre_historico: null,
    contacto_cargo_historico: null,
    contacto_telefono_historico: null,
    cliente: "PriceSmart",
    placa: null,
    piloto: null,
    auxiliar: null,
    piloto_id: null,
    auxiliar_id: null,
    piloto_empleado_id: null,
    piloto_telefono: null,
    auxiliar_empleado_id: null,
    auxiliar_telefono: null,
    evidencias: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({
    empresa: { id: EMPRESA_ID, nombre: "SITSA" },
    session: { id: 1, username: "ops1" },
  } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
  vi.mocked(listarParadasDePlanes).mockResolvedValue(new Map());
});

/**
 * TMS-PROGRAMACION-NAVEGACION-DIRECTA-PLAN — ?id=<planId> trae un plan
 * puntual, sin depender de fechaDesde/fechaHasta/pendienteCierre. Caso
 * real del ticket: PLAN-20260901-005 (fecha_plan 2026-09-01) visto un día
 * después — ningún filtro de rango lo cubriría, pero ?id= sí debe.
 */
describe("GET /api/empresas/[slug]/tms/planes?id=", () => {
  it("exige permiso ANTES de tocar la DB", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({
      error: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const res = await GET(req(`?id=${PLAN_ID}`), ctx);
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("id no numérico → 400, nunca consulta la DB", async () => {
    const res = await GET(req("?id=abc"), ctx);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("Caso A/B del ticket: filtra por empresa_id + id, SIN límite y SIN depender de fechaDesde/fechaHasta", async () => {
    vi.mocked(query).mockResolvedValueOnce([filaPlan()] as never);
    const res = await GET(req(`?id=${PLAN_ID}`), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.planes).toHaveLength(1);
    expect(data.planes[0]).toMatchObject({ id: PLAN_ID, codigo: "PLAN-20260901-005", fecha_plan: "2026-09-01" });

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("p.empresa_id = ?");
    expect(String(sql)).toContain("p.id = ?");
    expect(String(sql)).not.toContain("fecha_plan BETWEEN");
    expect(String(sql)).not.toContain("LIMIT 200");
    // paramsRows = [ahora, empresaId, idNum] — el id SIEMPRE junto a
    // empresa_id, nunca a secas.
    expect(params).toEqual([expect.any(String), EMPRESA_ID, PLAN_ID]);
  });

  it("Caso C del ticket: id de OTRA empresa (o inexistente) → 0 filas, nunca la fila real de otra empresa", async () => {
    // El propio WHERE `p.empresa_id = ? AND p.id = ?` es lo que hace que
    // MySQL no devuelva nada cuando el plan #31 pertenece a otra empresa
    // — se simula aquí devolviendo directamente 0 filas, mismo resultado
    // observable que "no existe".
    vi.mocked(query).mockResolvedValueOnce([] as never);
    const res = await GET(req(`?id=${PLAN_ID}`), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.planes).toEqual([]);
    // Con 0 filas no hay planIds -> nunca se ejecuta una segunda consulta
    // de auxiliares (auxiliaresDePlanes corta temprano).
    expect(vi.mocked(query).mock.calls).toHaveLength(1);
  });

  it("Caso D del ticket: SIN id -> comportamiento Hoy/Mañana/Semana intacto (fechaDesde/fechaHasta, LIMIT 200)", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await GET(req("?fechaDesde=2026-09-02&fechaHasta=2026-09-02"), ctx);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("fecha_plan BETWEEN ? AND ?");
    expect(String(sql)).toContain("LIMIT 200");
    expect(String(sql)).not.toContain("p.id = ?");
    expect(params).toEqual([expect.any(String), EMPRESA_ID, "2026-09-02", "2026-09-02"]);
  });
});
