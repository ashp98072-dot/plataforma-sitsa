import { beforeEach, expect, it, vi } from "vitest";
import type { PermisoModulo } from "@/lib/permisos-shared";
const m = vi.hoisted(() => ({ rows: [] as { modulo: string; puede_ver: number; puede_crear: number; puede_editar: number; puede_eliminar: number }[], conn: { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() } }));
vi.mock("@/lib/db", () => ({ query: async () => m.rows, getPool: () => ({ getConnection: async () => m.conn }) }));
import { guardarPermisosUsuario, permisosEfectivos } from "@/lib/permisos";
import { cambiarAccion, VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import { ACCIONES_COMBUSTIBLE, puedeCombustible } from "./combustible-permisos";
const p = (modulo: string, ver = false, editar = false): PermisoModulo => ({ modulo, puedeVer: ver, puedeCrear: false, puedeEditar: editar, puedeEliminar: false });
beforeEach(() => {
  vi.resetAllMocks(); m.rows = [];
  m.conn.execute.mockImplementation(async (sql: string, params: (string | number)[]) => {
    if (sql.startsWith("DELETE")) m.rows = [];
    if (sql.includes("INSERT INTO usuario_modulo")) m.rows.push({ modulo: String(params[1]), puede_ver: Number(params[2]), puede_crear: Number(params[3]), puede_editar: Number(params[4]), puede_eliminar: Number(params[5]) });
  });
});
it("lectura de matriz legacy no fabrica ceros que anulen editar; guardar/releer conserva revocación individual", async () => {
  m.rows = [{ modulo: "flota_combustible", puede_ver: 1, puede_crear: 0, puede_editar: 1, puede_eliminar: 0 }, { modulo: VERSION_PERMISOS, puede_ver: 1, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }];
  const efectiva = await permisosEfectivos(9, "JefeOperaciones");
  for (const accion of ACCIONES_COMBUSTIBLE) expect(puedeCombustible(efectiva, accion)).toBe(true);
  await guardarPermisosUsuario(9, cambiarAccion(efectiva, "flota_combustible", "revisar", false));
  const releida = await permisosEfectivos(9, "JefeOperaciones");
  expect(puedeCombustible(releida, "revisar")).toBe(false);
  for (const accion of ["registrar", "editar_pendientes", "conciliar", "gestionar_estaciones"] as const) expect(puedeCombustible(releida, accion)).toBe(true);
  expect(m.conn.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO usuario_modulo"), [9, "flota_combustible_revisar", 0, 0, 0, 0]);
  expect(m.conn.commit).toHaveBeenCalledOnce();
});
it("Guardar solo registrar persiste filas explícitas y no amplía otras acciones", async () => {
  await guardarPermisosUsuario(9, cambiarAccion([p(VERSION_PERMISOS, true), p("flota_combustible", true)], "flota_combustible", "registrar", true));
  const permisos = await permisosEfectivos(9, "JefeOperaciones");
  for (const accion of ACCIONES_COMBUSTIBLE) expect(puedeCombustible(permisos, accion)).toBe(accion === "ver" || accion === "registrar");
});
