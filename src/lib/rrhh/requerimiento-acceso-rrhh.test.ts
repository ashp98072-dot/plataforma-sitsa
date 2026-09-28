import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ requireTenant: vi.fn(), permisosEfectivos: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: m.requireTenant }));
vi.mock("@/lib/permisos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permisos")>("@/lib/permisos");
  return { ...actual, permisosEfectivos: m.permisosEfectivos };
});
import { requireRrhhProveedores, requireRrhhRequerimientos, requireRrhhRequerimientosAutorizar } from "./requerimiento-acceso";

const empresaBase = { id: 1, modulos: ["rrhh"] };
const sesion = (rol: string) => ({ id: 8, username: "user", rol });

beforeEach(() => { vi.resetAllMocks(); });

describe("44-47) permisos propios de RRHH (nunca los de Compras)", () => {
  it("44) sin ver -> bloqueado", async () => {
    m.requireTenant.mockResolvedValue({ session: sesion("RRHH"), empresa: empresaBase, error: undefined });
    m.permisosEfectivos.mockResolvedValue([]);
    const g = await requireRrhhRequerimientos("sitsa", "ver");
    expect(g.error).toBeDefined();
    expect(await g.error!.json()).toMatchObject({ error: expect.stringContaining("requerimientos de RRHH") });
  });
  it("45) sin crear -> no crear", async () => {
    m.requireTenant.mockResolvedValue({ session: sesion("RRHH"), empresa: empresaBase, error: undefined });
    m.permisosEfectivos.mockResolvedValue([{ modulo: "rrhh_requerimientos", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }]);
    expect((await requireRrhhRequerimientos("sitsa", "crear")).error).toBeDefined();
    expect((await requireRrhhRequerimientos("sitsa", "ver")).error).toBeUndefined();
  });
  it("46) sin editar -> no editar (proveedores)", async () => {
    m.requireTenant.mockResolvedValue({ session: sesion("RRHH"), empresa: empresaBase, error: undefined });
    m.permisosEfectivos.mockResolvedValue([{ modulo: "rrhh_proveedores", puedeVer: true, puedeCrear: true, puedeEditar: false, puedeEliminar: false }]);
    expect((await requireRrhhProveedores("sitsa", "editar")).error).toBeDefined();
    expect((await requireRrhhProveedores("sitsa", "crear")).error).toBeUndefined();
  });
  it("47) sin autorizar -> no autorizar (rrhh_requerimientos:editar específico)", async () => {
    m.requireTenant.mockResolvedValue({ session: sesion("RRHH"), empresa: empresaBase, error: undefined });
    m.permisosEfectivos.mockResolvedValue([{ modulo: "rrhh_requerimientos", puedeVer: true, puedeCrear: true, puedeEditar: false, puedeEliminar: false }]);
    expect((await requireRrhhRequerimientosAutorizar("sitsa")).error).toBeDefined();
  });
  it("compras_requerimientos/compras_proveedores NUNCA otorgan acceso a RRHH", async () => {
    m.requireTenant.mockResolvedValue({ session: sesion("Operaciones"), empresa: empresaBase, error: undefined });
    m.permisosEfectivos.mockResolvedValue([{ modulo: "compras_requerimientos", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }]);
    expect((await requireRrhhRequerimientos("sitsa", "ver")).error).toBeDefined();
  });
  it("empresa sin módulo RRHH bloquea antes de mirar permisos", async () => {
    m.requireTenant.mockResolvedValue({ session: sesion("RRHH"), empresa: { id: 1, modulos: ["tms"] }, error: undefined });
    const g = await requireRrhhRequerimientos("sitsa", "ver");
    expect(g.error).toBeDefined();
    expect(m.permisosEfectivos).not.toHaveBeenCalled();
  });
});

describe("48-50) auditoría: crear/editar/autorizar/rechazar registran módulo/acción propios", () => {
  it("los módulos de auditoría de RRHH son distintos de los de Compras", () => {
    const req = readFileSync("src/lib/rrhh/requerimientos.ts", "utf8");
    expect(req).toContain('modulo: "rrhh_requerimientos"');
    expect(req).not.toMatch(/FROM compras_|@\/lib\/compras/);
    expect(req).toContain("crear_requerimiento_rrhh");
    expect(req).toContain("editar_requerimiento_rrhh");
    expect(req).toContain("autorizar_requerimiento_rrhh");
    expect(req).toContain("rechazar_requerimiento_rrhh");
    const prov = readFileSync("src/lib/rrhh/proveedores.ts", "utf8");
    expect(prov).toContain('modulo: "rrhh_proveedores"');
    expect(prov).toContain("crear_proveedor_rrhh");
  });
});

describe("no SQL/permisos de Compras reutilizados por RRHH", () => {
  it("ningún archivo de src/lib/rrhh/requerimiento*.ts ni proveedor*.ts importa @/lib/compras", () => {
    for (const p of ["src/lib/rrhh/requerimientos.ts", "src/lib/rrhh/requerimiento-acceso.ts", "src/lib/rrhh/proveedores.ts", "src/lib/rrhh/proveedor-api.ts", "src/lib/rrhh/requerimiento-api.ts"]) {
      expect(readFileSync(p, "utf8")).not.toMatch(/@\/lib\/compras/);
    }
  });
  it("rrhh_requerimientos/rrhh_proveedores no se conceden por defecto a NINGÚN rol (permisosDefaultPorRol)", async () => {
    const { permisosDefaultPorRol } = await vi.importActual<typeof import("@/lib/permisos-shared")>("@/lib/permisos-shared");
    const roles = ["RRHH", "Reclutamiento", "Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones", "Facturador", "Contabilidad", "CoordinadorPredios", "CoordinadorCompras", "Piloto", "Visualizador", "Marcaje"] as const;
    for (const rol of roles) {
      const permisos = permisosDefaultPorRol(rol);
      const req = permisos.find(p => p.modulo === "rrhh_requerimientos");
      const prov = permisos.find(p => p.modulo === "rrhh_proveedores");
      if (req) expect(req).toMatchObject({ puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false });
      if (prov) expect(prov).toMatchObject({ puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false });
    }
  });
  it("Admin sí recibe rrhh_requerimientos/rrhh_proveedores completos por catálogo global", async () => {
    const { permisosDefaultPorRol } = await vi.importActual<typeof import("@/lib/permisos-shared")>("@/lib/permisos-shared");
    const permisos = permisosDefaultPorRol("Admin");
    expect(permisos.find(p => p.modulo === "rrhh_requerimientos")).toMatchObject({ puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true });
    expect(permisos.find(p => p.modulo === "rrhh_proveedores")).toMatchObject({ puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true });
  });
});

describe("navegación y guard de /rrhh/*", () => {
  it("el layout de /rrhh también deja pasar a quien SOLO tiene rrhh_requerimientos/rrhh_proveedores", () => {
    const layout = readFileSync("src/app/e/[slug]/rrhh/layout.tsx", "utf8");
    expect(layout).toContain('"rrhh_requerimientos", "rrhh_proveedores"');
  });
  it("guardRrhhAlguno acepta string[] (no solo RrhhSubmodulo[])", () => {
    const guard = readFileSync("src/lib/rrhh-page-guard.ts", "utf8");
    expect(guard).toContain("submodulos: string[]");
  });
  it("el sidebar RRHH agrega Requerimientos/Proveedores filtrados por permiso explícito", () => {
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(shell).toContain('"rrhh_requerimientos", "Requerimientos", "requerimientos"');
    expect(shell).toContain('"rrhh_proveedores", "Proveedores", "proveedores"');
    expect(shell).toContain('tienePermiso(permisos, modulo, "ver")');
  });
});
