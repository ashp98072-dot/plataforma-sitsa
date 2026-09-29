import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ execute: m.execute, query: m.query }));
import { listarPuestosDisponibles, listarUsuariosEntrevistadores } from "./entrevistas";

const EMPRESA = 7;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ATRACCION-TALENTO-2 (secciones 4-8) — listarUsuariosEntrevistadores", () => {
  it("1) usuario activo con acceso a la empresa y permiso entrevistas:ver -> aparece en el catálogo", async () => {
    m.query.mockImplementation(async (sql: unknown, params: unknown) => {
      const s = String(sql);
      if (s.includes("FROM usuarios")) {
        expect((params as unknown[])[0]).toBe(EMPRESA); // 3) acceso siempre filtrado por la empresa del guard
        return [{ id: 1, username: "mlopez", nombre: "María López", rol_global: "RRHH" }];
      }
      if (s.includes("FROM usuario_modulo")) return [{ modulo: "entrevistas", puede_ver: 1, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }];
      return [];
    });
    const r = await listarUsuariosEntrevistadores(EMPRESA);
    expect(r).toEqual([{ id: 1, nombre: "María López", username: "mlopez", rol: "RRHH" }]);
  });

  it("4) sin permiso entrevistas:ver -> NO aparece, aunque esté activo y tenga acceso a la empresa", async () => {
    m.query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes("FROM usuarios")) return [{ id: 2, username: "sinver", nombre: "Sin Permiso", rol_global: "Operaciones" }];
      if (s.includes("FROM usuario_modulo")) return []; // sin fila -> permisosDefaultPorRol("Operaciones"), que no concede entrevistas
      return [];
    });
    const r = await listarUsuariosEntrevistadores(EMPRESA);
    expect(r.find((u) => u.id === 2)).toBeUndefined();
  });

  it("14) NO asume que rol RRHH siempre implica el permiso: si fue revocado explícitamente (fila con puede_ver=0), no aparece", async () => {
    m.query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes("FROM usuarios")) return [{ id: 3, username: "revocado", nombre: "Revocado", rol_global: "RRHH" }];
      if (s.includes("FROM usuario_modulo")) return [{ modulo: "entrevistas", puede_ver: 0, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }];
      return [];
    });
    const r = await listarUsuariosEntrevistadores(EMPRESA);
    expect(r.find((u) => u.id === 3)).toBeUndefined();
  });

  it("5) Admin siempre permitido, sin necesitar ninguna fila en usuario_modulo", async () => {
    m.query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes("FROM usuarios")) return [{ id: 4, username: "admin", nombre: null, rol_global: "Admin" }];
      return []; // nunca debería llamarse FROM usuario_modulo para Admin, pero devolver [] igual por si acaso
    });
    const r = await listarUsuariosEntrevistadores(EMPRESA);
    expect(r).toEqual([{ id: 4, nombre: "admin", username: "admin", rol: "Admin" }]);
  });

  it("nombre visible: usa nombre.trim() y cae a username cuando nombre es null/vacío", async () => {
    m.query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes("FROM usuarios")) return [{ id: 5, username: "sinnombre", nombre: "  ", rol_global: "Admin" }];
      return [];
    });
    const r = await listarUsuariosEntrevistadores(EMPRESA);
    expect(r[0].nombre).toBe("sinnombre");
  });

  it("2) la consulta de candidatos filtra por activo = 1", async () => {
    m.query.mockResolvedValueOnce([]);
    await listarUsuariosEntrevistadores(EMPRESA);
    const [sql] = m.query.mock.calls[0];
    expect(String(sql)).toContain("activo = 1");
  });

  it("6) payload mínimo: solo id/nombre/username/rol — nunca password_hash, salt ni permisos completos", async () => {
    m.query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes("FROM usuarios")) return [{ id: 6, username: "u6", nombre: "Seis", rol_global: "Admin" }];
      return [];
    });
    const r = await listarUsuariosEntrevistadores(EMPRESA);
    expect(Object.keys(r[0]).sort()).toEqual(["id", "nombre", "rol", "username"]);
  });

  it("7) tenant: la consulta de candidatos siempre recibe el empresaId del guard (nunca confiado del cliente)", async () => {
    m.query.mockResolvedValueOnce([]);
    await listarUsuariosEntrevistadores(42);
    const [sql, params] = m.query.mock.calls[0];
    expect(String(sql)).toContain("usuario_empresa");
    expect(params).toEqual([42]);
  });

  it("N+1: como máximo 1 consulta de candidatos + 1 consulta de permisos por candidato NO-Admin (nunca por todos los usuarios del sistema)", async () => {
    m.query.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes("FROM usuarios")) return [
        { id: 1, username: "a", nombre: "A", rol_global: "RRHH" },
        { id: 2, username: "b", nombre: "B", rol_global: "Admin" },
      ];
      if (s.includes("FROM usuario_modulo")) return [{ modulo: "entrevistas", puede_ver: 1, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }];
      return [];
    });
    await listarUsuariosEntrevistadores(EMPRESA);
    // 1 (candidatos) + 1 (permisos del RRHH, no-Admin) = 2. El Admin no dispara una consulta de permisos.
    expect(m.query).toHaveBeenCalledTimes(2);
  });
});

describe("ATRACCION-TALENTO-2 (sección 12) — listarPuestosDisponibles", () => {
  it("24/26/27) DISTINCT real, solo de esta empresa, orden alfabético", async () => {
    m.query.mockResolvedValueOnce([{ puesto: "Auxiliar" }, { puesto: "Piloto" }] as never);
    const r = await listarPuestosDisponibles(EMPRESA);
    expect(r).toEqual(["Auxiliar", "Piloto"]);
    const [sql, params] = m.query.mock.calls[0];
    expect(String(sql)).toContain("DISTINCT");
    expect(String(sql)).toContain("ORDER BY puesto");
    expect(params).toEqual([EMPRESA, EMPRESA]);
  });

  it("25) elimina vacíos: el propio SQL filtra TRIM(COALESCE(puesto,'')) <> ''", async () => {
    m.query.mockResolvedValueOnce([] as never);
    await listarPuestosDisponibles(EMPRESA);
    const [sql] = m.query.mock.calls[0];
    expect(String(sql)).toContain("TRIM(COALESCE(puesto, '')) <> ''");
  });

  it("nunca mezcla puestos de otra empresa: ambas mitades de la unión filtran por empresa_id", async () => {
    m.query.mockResolvedValueOnce([] as never);
    await listarPuestosDisponibles(EMPRESA);
    const [sql] = m.query.mock.calls[0];
    const ocurrencias = String(sql).split("empresa_id = ?").length - 1;
    expect(ocurrencias).toBe(2); // una vez para empleados, una vez para entrevistas
  });

  it("fuente: unión de empleados.puesto (plazas reales) y entrevistas.puesto (histórico de reclutamientos, incluye 'Otro puesto')", async () => {
    m.query.mockResolvedValueOnce([] as never);
    await listarPuestosDisponibles(EMPRESA);
    const [sql] = m.query.mock.calls[0];
    expect(String(sql)).toContain("FROM empleados");
    expect(String(sql)).toContain("FROM entrevistas");
  });
});
