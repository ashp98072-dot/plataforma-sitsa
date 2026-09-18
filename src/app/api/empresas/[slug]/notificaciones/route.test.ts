import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenant: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/rrhh/vacaciones", () => ({ sincronizarVacacionesEmpleadosActivos: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rrhh/vacaciones-alertas-ui", () => ({ resumenNotificacionesVacaciones: vi.fn().mockReturnValue([]) }));
vi.mock("@/lib/flota/acceso", () => ({ listarVehiculosParaAlertasKm: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/rrhh/recordatorios", () => ({ listarRecordatorios: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/rrhh/dates", () => ({ ahoraLocal: vi.fn().mockReturnValue("2026-09-18 12:00:00"), formatearTimestampVisible: vi.fn().mockReturnValue("") }));
vi.mock("@/lib/permisos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/permisos")>();
  return { ...real, permisosEfectivos: vi.fn() };
});

import { requireTenant } from "@/lib/tenant";
import { query } from "@/lib/db";
import { permisosEfectivos } from "@/lib/permisos";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { GET } from "./route";

const ctx = (slug = "sitsa") => ({ params: Promise.resolve({ slug }) });

/**
 * COMPRAS-NOTIFICACIONES (Parte E) — la alerta "alerta-compras-autorizar"
 * dentro del feed unificado de la campana. Suite dedicada (no toca las
 * demás secciones del endpoint, todas mockeadas a vacío) porque el
 * ticket exige cobertura exhaustiva de gating por permiso, aislamiento
 * por empresa y forma exacta de la notificación.
 */
function guard(rol: string, empresaId = 1) {
  vi.mocked(requireTenant).mockResolvedValue({
    session: { id: 5, rol, username: "user1", nombre: "Usuario Uno" },
    empresa: { id: empresaId, modulos: [] },
  } as never);
}

function permisos(overrides: Record<string, { puedeVer?: boolean; puedeEditar?: boolean }>): PermisoModulo[] {
  return Object.entries(overrides).map(([modulo, acc]) => ({
    modulo,
    puedeVer: Boolean(acc.puedeVer),
    puedeCrear: false,
    puedeEditar: Boolean(acc.puedeEditar),
    puedeEliminar: false,
  }));
}

/** Simula solo la tabla compras_requerimientos; todo lo demás vacío/[]. */
function mockQueryCompras(porEmpresa: Record<number, number>) {
  vi.mocked(query).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM compras_requerimientos")) {
      const empresaId = Number((params as number[])[0]);
      return [{ c: porEmpresa[empresaId] ?? 0 }] as never;
    }
    return [] as never;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue([] as never);
});

describe("Alerta compras_autorizar", () => {
  it("Admin con 2 Pendientes ve la alerta", async () => {
    guard("Admin");
    mockQueryCompras({ 1: 2 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.notificaciones).toContainEqual(expect.objectContaining({ id: "alerta-compras-autorizar", detalle: "2 requerimiento(s) pendiente(s) de autorización" }));
  });

  it("usuario con compras_autorizar:editar ve la alerta", async () => {
    guard("Operaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue(permisos({ compras_autorizar: { puedeVer: true, puedeEditar: true } }));
    mockQueryCompras({ 1: 3 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.notificaciones.some((n: { id: string }) => n.id === "alerta-compras-autorizar")).toBe(true);
  });

  it("usuario sin compras_autorizar en absoluto no ve la alerta (y no se calcula el COUNT)", async () => {
    guard("Operaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue([]);
    mockQueryCompras({ 1: 5 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.notificaciones.some((n: { id: string }) => n.id === "alerta-compras-autorizar")).toBe(false);
    expect(vi.mocked(query).mock.calls.some(([sql]) => String(sql).includes("FROM compras_requerimientos"))).toBe(false);
  });

  it("usuario con solo compras_requerimientos:ver no ve la alerta", async () => {
    guard("Operaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue(permisos({ compras_requerimientos: { puedeVer: true } }));
    mockQueryCompras({ 1: 5 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.notificaciones.some((n: { id: string }) => n.id === "alerta-compras-autorizar")).toBe(false);
  });

  it("usuario con solo compras_requerimientos:editar no ve la alerta", async () => {
    guard("Operaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue(permisos({ compras_requerimientos: { puedeVer: true, puedeEditar: true } }));
    mockQueryCompras({ 1: 5 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.notificaciones.some((n: { id: string }) => n.id === "alerta-compras-autorizar")).toBe(false);
  });

  it("0 Pendientes: la alerta se omite por completo (no aparece con detalle en cero)", async () => {
    guard("Admin");
    mockQueryCompras({ 1: 0 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.notificaciones.some((n: { id: string }) => n.id === "alerta-compras-autorizar")).toBe(false);
  });

  it("Autorizada/Rechazada no cuentan: la query filtra explícitamente por estado = 'Pendiente'", async () => {
    guard("Admin");
    mockQueryCompras({ 1: 1 });
    await GET(new Request("http://x"), ctx());
    const llamada = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("FROM compras_requerimientos"))!;
    expect(String(llamada[0])).toContain("estado = 'Pendiente'");
    expect(String(llamada[0])).not.toMatch(/JOIN/i);
  });

  it("aislamiento por empresa: el COUNT filtra por empresa_id, la empresa B no ve los Pendientes de la A", async () => {
    guard("Admin", 2);
    mockQueryCompras({ 1: 9, 2: 0 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.notificaciones.some((n: { id: string }) => n.id === "alerta-compras-autorizar")).toBe(false);
    const llamada = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("FROM compras_requerimientos"))!;
    expect(llamada[1]).toEqual([2]);
  });

  it("el detalle expone el COUNT exacto y el enlace apunta al listado de requerimientos", async () => {
    guard("Admin");
    mockQueryCompras({ 1: 7 });
    const data = await (await GET(new Request("http://x"), ctx("acme"))).json();
    const n = data.notificaciones.find((x: { id: string }) => x.id === "alerta-compras-autorizar");
    expect(n).toMatchObject({
      tipo: "aprobacion",
      titulo: "Requerimientos de compra pendientes de autorización",
      detalle: "7 requerimiento(s) pendiente(s) de autorización",
      enlace: "/e/acme/compras/requerimientos",
      creadoAt: null,
    });
  });

  it("tipo aprobacion: contribuye al contador `pendientes` del feed", async () => {
    guard("Admin");
    mockQueryCompras({ 1: 1 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    expect(data.pendientes).toBeGreaterThanOrEqual(1);
  });

  it("nunca incluye acciones directas aprobar/rechazar (la decisión exige firma+version desde el listado)", async () => {
    guard("Admin");
    mockQueryCompras({ 1: 4 });
    const data = await (await GET(new Request("http://x"), ctx())).json();
    const n = data.notificaciones.find((x: { id: string }) => x.id === "alerta-compras-autorizar");
    expect(n.acciones).toBeUndefined();
  });

  it("autoautorización visible: el propio Pendiente del requirente cuenta igual si tiene el permiso (sin filtro por requirente/solicitante/creado_por)", async () => {
    guard("Operaciones");
    vi.mocked(permisosEfectivos).mockResolvedValue(permisos({ compras_autorizar: { puedeVer: true, puedeEditar: true } }));
    mockQueryCompras({ 1: 1 });
    await GET(new Request("http://x"), ctx());
    const llamada = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("FROM compras_requerimientos"))!;
    expect(String(llamada[0])).not.toMatch(/requirente_usuario_id|solicitante_usuario_id|creado_por/);
  });
});
