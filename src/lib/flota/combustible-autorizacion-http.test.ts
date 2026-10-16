import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async original => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: vi.fn() }));
const m = vi.hoisted(() => ({ guardar: vi.fn(), catalogos: vi.fn(), listar: vi.fn(), revisar: vi.fn(), archivo: vi.fn(), resumen: vi.fn(), guardarEstacion: vi.fn(), estaciones: vi.fn(), proveedores: vi.fn(), fondos: vi.fn() }));
vi.mock("./combustible-fondos", () => ({ buscarLineasFondoCombustible: m.fondos }));
vi.mock("./combustible-staff", () => ({ guardarCombustibleStaff: m.guardar, catalogosCombustible: m.catalogos }));
vi.mock("./combustible", () => ({ listarCargasCombustibleRevision: m.listar, revisarCargaCombustible: m.revisar, obtenerArchivoCargaCombustiblePorEmpresa: m.archivo, resumenCombustibleMensual: m.resumen }));
vi.mock("./combustible-estaciones", async original => ({ ...await original<typeof import("./combustible-estaciones")>(), guardarEstacion: m.guardarEstacion, listarEstaciones: m.estaciones, listarProveedoresActivos: m.proveedores }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("./combustible-conciliacion-consultas", () => ({ listarConciliacionesCombustible: async () => [], obtenerConciliacionCombustible: async () => null, obtenerArchivoConciliacionCombustible: async () => null }));
import { getSession } from "@/lib/session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { cambiarAccion, VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { GET as listar, POST as crear } from "@/app/api/empresas/[slug]/flota/combustible/route";
import { PATCH as editar } from "@/app/api/empresas/[slug]/flota/combustible/[id]/route";
import { POST as revisar } from "@/app/api/empresas/[slug]/flota/combustible/[id]/revisar/route";
import { GET as evidencia } from "@/app/api/empresas/[slug]/flota/combustible/[id]/vale/route";
import { GET as catalogos } from "@/app/api/empresas/[slug]/flota/combustible/catalogos/route";
import { GET as fondos } from "@/app/api/empresas/[slug]/flota/combustible/fondos/route";
import { GET as importaciones, POST as confirmarImportacion } from "@/app/api/empresas/[slug]/flota/combustible/importaciones/route";
import { POST as previewImportacion } from "@/app/api/empresas/[slug]/flota/combustible/importaciones/preview/route";
import { GET as detalleImportacion } from "@/app/api/empresas/[slug]/flota/combustible/importaciones/[id]/route";
const importMock = vi.hoisted(() => ({ listar: vi.fn(), detalle: vi.fn(), preview: vi.fn(), confirmar: vi.fn() }));
vi.mock("./combustible-importaciones", () => ({ listarImportaciones: importMock.listar, detalleImportacion: importMock.detalle, previewImportacion: importMock.preview, confirmarImportacion: importMock.confirmar }));
import { GET as resumen } from "@/app/api/empresas/[slug]/flota/combustible/resumen/route";
import { POST as conciliar } from "@/app/api/empresas/[slug]/flota/combustible/conciliaciones/route";
import { GET as historial } from "@/app/api/empresas/[slug]/flota/combustible/conciliaciones/route";
import { GET as detalleConciliacion } from "@/app/api/empresas/[slug]/flota/combustible/conciliaciones/[id]/route";
import { GET as originalConciliacion } from "@/app/api/empresas/[slug]/flota/combustible/conciliaciones/[id]/archivo/route";
import { GET as estaciones, POST as altaEstacion } from "@/app/api/empresas/[slug]/flota/combustible/estaciones/route";
import { PATCH as editarEstacion } from "@/app/api/empresas/[slug]/flota/combustible/estaciones/[id]/route";
const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["tms"] };
const ctx = { params: Promise.resolve({ slug: "kt", id: "5" }) };
const p = (modulo: string, ver = false): PermisoModulo => ({ modulo, puedeVer: ver, puedeCrear: false, puedeEditar: false, puedeEliminar: false });
const base = [p(VERSION_PERMISOS, true), p("flota_combustible", true)];
const json = (body: object) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function formulario() {
  const f = new FormData();
  for (const [k, v] of Object.entries({ proveedorId: "3", estacionId: "55", vehiculoId: "7", numeroVale: "V-1", fechaConsumo: "2026-10-15", tipoCombustible: "diesel", galones: "1", monto: "30" })) f.set(k, v);
  f.set("file", new File(["PDF"], "vale.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/x", { method: "POST", body: f });
}
const writes = [
  { permiso: "registrar", call: () => crear(formulario(), ctx), permitido: 201 },
  { permiso: "editar_pendientes", call: () => editar(formulario(), ctx), permitido: 200 },
  { permiso: "revisar", call: () => revisar(json({ accion: "aprobar" }), ctx), permitido: 200 },
  // Sin archivo: 400 prueba que superó autorización, pero no ejecuta importación/escritura.
  { permiso: "conciliar", call: () => conciliar(new Request("http://localhost/x", { method: "POST", body: new FormData() }), ctx), permitido: 400 },
  { permiso: "gestionar_estaciones", call: () => altaEstacion(json({ proveedorId: 3, nombre: "A" }), ctx), permitido: 201 },
  { permiso: "gestionar_estaciones", call: () => editarEstacion(json({ activo: false }), ctx), permitido: 200 },
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 9, username: "op", rol: "JefeOperaciones", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue(base);
  m.guardar.mockResolvedValue(5); m.catalogos.mockResolvedValue({ estaciones: [{ id: 55, proveedorId: 3, nombre: "Activa" }] });
  m.listar.mockResolvedValue({ items: [], resumen: {} }); m.revisar.mockResolvedValue({ ok: true });
  m.archivo.mockResolvedValue(null); m.resumen.mockResolvedValue({}); m.estaciones.mockResolvedValue([]); m.proveedores.mockResolvedValue([]); m.guardarEstacion.mockResolvedValue(55);
});
describe("rutas HTTP con guard real, no guard simulado", () => {
  it("importaciones Ver consulta pero no importa; Conciliar permite preview/confirmar", async () => {
    importMock.listar.mockResolvedValue([]); importMock.detalle.mockResolvedValue(null);
    expect((await importaciones(new Request("http://localhost/x"), ctx)).status).toBe(200);
    expect((await detalleImportacion(new Request("http://localhost/x"), ctx)).status).toBe(404);
    const req = () => { const f = new FormData(); f.set("proveedorId", "3"); f.set("file", new File(["PK"], "a.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); f.set("token", "recibo"); return new Request("http://localhost/x", { method: "POST", body: f }); };
    expect((await previewImportacion(req(), ctx)).status).toBe(403);
    expect((await confirmarImportacion(req(), ctx)).status).toBe(403);
    vi.mocked(permisosEfectivos).mockResolvedValue(cambiarAccion(base, "flota_combustible", "conciliar", true));
    importMock.preview.mockResolvedValue({ token: "recibo" }); importMock.confirmar.mockResolvedValue({ id: 42 });
    expect((await previewImportacion(req(), ctx)).status).toBe(200);
    expect((await confirmarImportacion(req(), ctx)).status).toBe(201);
    expect(importMock.confirmar).toHaveBeenCalledWith(7, 3, { id: 9, username: "op" }, expect.any(Buffer), expect.any(File), "recibo");
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await previewImportacion(req(), ctx)).status).toBe(403);
    expect((await importaciones(new Request("http://localhost/x"), ctx)).status).toBe(403);
  });
  it.each(["ver", "registrar", "editar_pendientes", "revisar", "conciliar", "gestionar_estaciones"] as const)("Ver + %s permite únicamente su acción", async accion => {
    vi.mocked(permisosEfectivos).mockResolvedValue(cambiarAccion(base, "flota_combustible", accion, true));
    expect((await listar(new Request("http://localhost/x"), ctx)).status).toBe(200);
    expect((await resumen(new Request("http://localhost/x?mes=2026-10"), ctx)).status).toBe(200);
    expect((await evidencia(new Request("http://localhost/x"), ctx)).status).toBe(404); // autorizado, archivo inexistente
    expect((await catalogos(new Request("http://localhost/x"), ctx)).status).toBe(200);
    expect((await historial(new Request("http://localhost/x"), ctx)).status).toBe(200);
    expect((await detalleConciliacion(new Request("http://localhost/x"), ctx)).status).toBe(404);
    expect((await originalConciliacion(new Request("http://localhost/x"), ctx)).status).toBe(404);
    for (const w of writes) expect((await w.call()).status, `${accion} -> ${w.permiso}`).toBe(w.permiso === accion ? w.permitido : 403);
    expect((await estaciones(new Request("http://localhost/x"), ctx)).status).toBe(accion === "gestionar_estaciones" ? 200 : 403);
  });
  it("registrar consume estaciones activas sin habilitar mantenimiento y usa tenant del servidor", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue(cambiarAccion(base, "flota_combustible", "registrar", true));
    const res = await catalogos(new Request("http://localhost/x?empresa_id=999"), ctx);
    expect((await res.json()).estaciones[0].id).toBe(55); expect(m.catalogos).toHaveBeenCalledWith(7);
    expect((await crear(formulario(), ctx)).status).toBe(201);
    expect(m.guardar).toHaveBeenCalledWith(7, { usuarioId: 9, username: "op" }, expect.objectContaining({ estacionId: 55 }), expect.any(File), undefined);
    expect((await altaEstacion(json({ proveedorId: 3, nombre: "A" }), ctx)).status).toBe(403);
  });
  it("sin Ver, aunque existan filas especializadas no hay elevación por URL", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p(VERSION_PERMISOS, true), ...writes.map(w => p(`flota_combustible_${w.permiso}`, true))]);
    expect((await listar(new Request("http://localhost/x"), ctx)).status).toBe(403);
    for (const read of [catalogos, resumen, evidencia, historial, detalleConciliacion, originalConciliacion, estaciones]) expect((await read(new Request("http://localhost/x"), ctx)).status).toBe(403);
    for (const w of writes) expect((await w.call()).status).toBe(403);
    expect(m.guardar).not.toHaveBeenCalled(); expect(m.revisar).not.toHaveBeenCalled(); expect(m.guardarEstacion).not.toHaveBeenCalled();
  });
  it("Admin conserva todas las acciones, pero nunca salta acceso a empresa", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 9, username: "admin", rol: "Admin", empresaId: 7 } as never);
    for (const w of writes) expect((await w.call()).status).toBe(w.permitido);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    for (const w of writes) expect((await w.call()).status).toBe(403);
  });
  it("empresa B no accesible bloquea todas las rutas y no toca servicios", async () => {
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, id: 8, slug: "otra" } as never);
    vi.mocked(permisosEfectivos).mockResolvedValue([p("flota_combustible", true)]);
    for (const w of writes) expect((await w.call()).status).toBe(403);
    expect((await catalogos(new Request("http://localhost/x"), ctx)).status).toBe(403);
    expect(m.catalogos).not.toHaveBeenCalled(); expect(m.guardar).not.toHaveBeenCalled();
  });
  it("TMS deshabilitado no se recupera por permisos completos", async () => {
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["flota"] } as never);
    for (const w of writes) expect((await w.call()).status).toBe(403);
  });
  it.each(["registrar", "editar_pendientes"] as const)("catálogo de fondos admite %s sin conceder editar Fondos", async accion => {
    vi.mocked(permisosEfectivos).mockResolvedValue(cambiarAccion(base, "flota_combustible", accion, true));
    m.fondos.mockResolvedValue([]);
    const res = await fondos(new Request("http://localhost/x?q=SF&empresa_id=999"), ctx);
    expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(m.fondos).toHaveBeenCalledWith(7, "SF", undefined);
  });
  it("solo ver no permite buscar nuevas asociaciones, sí resumen operativo", async () => {
    m.fondos.mockResolvedValue([]);
    expect((await fondos(new Request("http://localhost/x?q=SF"), ctx)).status).toBe(403);
    expect((await fondos(new Request("http://localhost/x?lineaId=42"), ctx)).status).toBe(200);
    expect(m.fondos).toHaveBeenCalledWith(7, "", 42);
    expect((await fondos(new Request("http://localhost/x?lineaId=-1"), ctx)).status).toBe(400);
  });
  it("catálogo fondos respeta tenant y módulo sin fallback TMS/Gastos", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p("tms", true), p("gastos", true)]);
    expect((await fondos(new Request("http://localhost/x"), ctx)).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, id: 8 } as never);
    expect((await fondos(new Request("http://localhost/x?lineaId=42"), ctx)).status).toBe(403);
    expect(m.fondos).not.toHaveBeenCalled();
  });
});
