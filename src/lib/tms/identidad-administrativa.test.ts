import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import {
  CODIGOS_ENTIDAD_REQUIRIENTE,
  ROLES_SOLICITANTE_OPERACIONES,
  ROLES_SOLICITANTE_FONDOS_GASTOS,
  ERROR_REQUIRIENTE_FONDOS_GASTOS,
  esUsuarioSolicitanteFondosGastos,
  resolverSolicitanteFondosGastosTx,
  resolverEntidadRequirenteTx,
  resolverRequirenteOperacionesTx,
  esUsuarioOperaciones,
  resolverSolicitanteOperacionesTx,
  resolverUsuarioDeEmpresaTx,
  validarEmpleadoDeEmpresaTx,
} from "./identidad-administrativa";

/**
 * GASTOS-ADMINISTRATIVO-1 — estas pruebas cubren el módulo EXTRAÍDO de
 * fondos.ts. No repiten las pruebas de fondos.test.ts (que ya demuestran,
 * sin haber necesitado tocar una sola línea de ese archivo tras el
 * refactor, que Fondos sigue funcionando idéntico); aquí se prueban los
 * helpers de forma aislada, con el mismo criterio de mock que
 * fondos.test.ts (una `conn` falsa con `query` despachando por texto SQL).
 */
function conn(respuesta: unknown[]): PoolConnection {
  return { query: vi.fn(async () => [respuesta]) } as unknown as PoolConnection;
}

describe("criterio único de usuario Operaciones y snapshots históricos", () => {
  it.each(["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones"])("rol %s aceptado", async rol => {
    expect(esUsuarioOperaciones(rol)).toBe(true);
    const c = conn([{ nombre: "Servidor", rol_global: rol }]);
    expect(await resolverRequirenteOperacionesTx(c, 7, { requirenteUsuarioId: 9, requirenteNombre: "Inventado" })).toEqual({ nombre: "Servidor", rol });
    expect(c.query).toHaveBeenCalledWith(expect.stringContaining("ue.empresa_id = ?"), [7, 9]);
  });
  it.each(["Admin", "Contabilidad", "Facturador", "CoordinadorCompras", "CoordinadorPredios"])("FONDOS/GASTOS: rol %s también aceptado (con validación de empresa), pero NO es Operaciones para Compras", async rol => {
    expect(esUsuarioSolicitanteFondosGastos(rol)).toBe(true);
    expect(esUsuarioOperaciones(rol)).toBe(false);   // Compras conserva la regla estricta
    const c = conn([{ nombre: "Servidor", rol_global: rol }]);
    expect(await resolverRequirenteOperacionesTx(c, 7, { requirenteUsuarioId: 9, requirenteNombre: "Inventado" })).toEqual({ nombre: "Servidor", rol });
    expect(c.query).toHaveBeenCalledWith(expect.stringContaining("ue.empresa_id = ?"), [7, 9]);
    expect(await resolverSolicitanteFondosGastosTx(conn([{ nombre: "Servidor", rol_global: rol }]), 7, 9)).toEqual({ nombre: "Servidor", rol });
    expect(await resolverSolicitanteOperacionesTx(conn([{ nombre: "Servidor", rol_global: rol }]), 7, 9)).toBeNull();   // la resolución de Compras NO cambió
  });
  it.each(["RRHH", "Reclutamiento", "Marcaje", "Piloto", "Visualizador", "Gerencia", "", null])("rol %s rechazado", async rol => {
    expect(esUsuarioSolicitanteFondosGastos(rol)).toBe(false);
    expect(esUsuarioOperaciones(rol)).toBe(false);
    await expect(resolverRequirenteOperacionesTx(conn([{ nombre: "Persona", rol_global: rol }]), 7, { requirenteUsuarioId: 9 })).rejects.toThrow(ERROR_REQUIRIENTE_FONDOS_GASTOS);
    expect(await resolverSolicitanteFondosGastosTx(conn([{ nombre: "Persona", rol_global: rol }]), 7, 9)).toBeNull();
  });
  it("el conjunto de roles habilitados es exactamente Operaciones + Admin, Contabilidad, Facturador y Coordinadores (nada más)", () => {
    expect([...ROLES_SOLICITANTE_FONDOS_GASTOS].sort()).toEqual([...ROLES_SOLICITANTE_OPERACIONES, "Admin", "Contabilidad", "Facturador", "CoordinadorCompras", "CoordinadorPredios"].sort());
  });
  it("usuario ajeno o inactivo se rechaza con consulta tenant-safe", async () => {
    const c = conn([]);
    await expect(resolverRequirenteOperacionesTx(c, 7, { requirenteUsuarioId: 999 })).rejects.toThrow("usuario activo de Operaciones");
    expect(c.query).toHaveBeenCalledWith(expect.stringContaining("u.activo = 1"), [7, 999]);
  });
  it.each([9, null])("histórico %s sin cambios no requiere revalidación", async id => {
    const c = conn([]);
    expect(await resolverRequirenteOperacionesTx(c, 7, { requirenteUsuarioId: id, requirenteNombre: "Anterior" }, { requirente_usuario_id: id, requirente_nombre: "Anterior" })).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });
  it("texto libre nuevo o cambio manual histórico rechazados", async () => {
    await expect(resolverRequirenteOperacionesTx(conn([]), 7, { requirenteNombre: "Manual" })).rejects.toThrow("usuario activo de Operaciones");
    await expect(resolverRequirenteOperacionesTx(conn([]), 7, { requirenteNombre: "Otro" }, { requirente_nombre: "Anterior" })).rejects.toThrow("usuario activo de Operaciones");
  });
});

describe("alcance de la ampliación de roles: SOLO Fondos y Gastos", () => {
  const leer = (r: string) => readFileSync(r, "utf8");
  it("el catálogo que alimenta las listas de Fondos y Gastos usa el criterio ampliado (solicitante y requirente)", () => {
    const src = leer("src/app/api/empresas/[slug]/tms/gastos/catalogos/route.ts");
    expect(src.match(/esUsuarioSolicitanteFondosGastos\(r\.rol_global\)/g)).toHaveLength(2);
    expect(src).not.toContain("esUsuarioOperaciones");
  });
  it("Fondos y Gastos validan en el SERVIDOR con el criterio ampliado (no basta con mostrar más usuarios en la lista)", () => {
    for (const f of ["src/lib/tms/fondos.ts", "src/lib/tms/gastos.ts"]) {
      const src = leer(f);
      expect(src).toContain("resolverSolicitanteFondosGastosTx(");
      expect(src).not.toContain("resolverSolicitanteOperacionesTx");
    }
  });
  it("Compras (requerimientos) CONSERVA la regla estricta de Operaciones", () => {
    const src = leer("src/lib/compras/requerimientos.ts");
    expect(src).toContain("resolverSolicitanteOperacionesTx(conn, empresaId, datos.requirente_usuario_id)");
    expect(src).toContain("esUsuarioOperaciones(r.rol_global)");
    expect(src).not.toContain("FondosGastos");
  });
  it("sigue validando empresa y usuario activo (la consulta no cambió)", async () => {
    const c = conn([]);
    expect(await resolverSolicitanteFondosGastosTx(c, 7, 999)).toBeNull();
    expect(c.query).toHaveBeenCalledWith(expect.stringContaining("u.activo = 1"), [7, 999]);
    expect(c.query).toHaveBeenCalledWith(expect.stringContaining("ue.empresa_id = ?"), [7, 999]);
  });
});

describe("validarEmpleadoDeEmpresaTx", () => {
  it("no hace nada si empleadoId es null/undefined (relación opcional)", async () => {
    const c = conn([]);
    await expect(validarEmpleadoDeEmpresaTx(c, 7, null, "requirente")).resolves.toBeUndefined();
    await expect(validarEmpleadoDeEmpresaTx(c, 7, undefined, "requirente")).resolves.toBeUndefined();
    expect(c.query).not.toHaveBeenCalled();
  });

  it("rechaza con un mensaje que incluye la etiqueta si el empleado no pertenece a la empresa", async () => {
    const c = conn([]);
    await expect(validarEmpleadoDeEmpresaTx(c, 7, 999, "autorizante")).rejects.toThrow("El autorizante indicado no pertenece a esta empresa.");
  });

  it("pasa silenciosamente si el empleado sí pertenece a la empresa", async () => {
    const c = conn([{ id: 3 }]);
    await expect(validarEmpleadoDeEmpresaTx(c, 7, 3, "requirente")).resolves.toBeUndefined();
  });

  it("AISLAMIENTO MULTIEMPRESA: filtra por (id, empresa_id), no solo por id", async () => {
    const c = conn([{ id: 3 }]);
    await validarEmpleadoDeEmpresaTx(c, 7, 3, "requirente");
    const [sql, params] = vi.mocked(c.query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("FROM empleados WHERE id = ? AND empresa_id = ?");
    expect(params).toEqual([3, 7]);
  });
});

describe("resolverEntidadRequirenteTx", () => {
  it("catálogo restringido a KT (Kuiqtrans) y MONACO (Logiservicios Mónaco)", () => {
    expect(CODIGOS_ENTIDAD_REQUIRIENTE).toEqual(["KT", "MONACO"]);
  });

  it("rechaza si la entidad no existe, no está activa o no pertenece a la empresa", async () => {
    const c = conn([]);
    await expect(resolverEntidadRequirenteTx(c, 7, 999)).rejects.toThrow("La empresa requirente no es válida, no está activa o no pertenece a esta empresa.");
  });

  it("devuelve {id, nombre} cuando la entidad es válida", async () => {
    const c = conn([{ id: 4, nombre: "Kuiqtrans, S.A." }]);
    const r = await resolverEntidadRequirenteTx(c, 7, 4);
    expect(r).toEqual({ id: 4, nombre: "Kuiqtrans, S.A." });
  });

  it("la consulta exige empresa_id, activa=1 y el código dentro de KT/MONACO", async () => {
    const c = conn([{ id: 4, nombre: "Kuiqtrans, S.A." }]);
    await resolverEntidadRequirenteTx(c, 7, 4);
    const [sql, params] = vi.mocked(c.query).mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("FROM cont_entidades");
    expect(sql).toContain("activa = 1");
    expect(sql).toContain("codigo IN (?, ?)");
    expect(params).toEqual([4, 7, "KT", "MONACO"]);
  });
});

describe("resolverUsuarioDeEmpresaTx", () => {
  it("devuelve null si usuarioId es null/undefined, sin consultar", async () => {
    const c = conn([]);
    expect(await resolverUsuarioDeEmpresaTx(c, 7, null)).toBeNull();
    expect(await resolverUsuarioDeEmpresaTx(c, 7, undefined)).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });

  it("devuelve null si el usuario no existe o no tiene acceso a esta empresa (nunca lanza)", async () => {
    const c = conn([]);
    expect(await resolverUsuarioDeEmpresaTx(c, 7, 999)).toBeNull();
  });

  it("devuelve {nombre, rol} cuando el usuario existe y tiene acceso", async () => {
    const c = conn([{ nombre: "Heber Sitan", rol_global: "JefeOperaciones" }]);
    expect(await resolverUsuarioDeEmpresaTx(c, 7, 9)).toEqual({ nombre: "Heber Sitan", rol: "JefeOperaciones" });
  });

  it("rol null se mapea a null (nunca undefined ni cadena vacía)", async () => {
    const c = conn([{ nombre: "Heber Sitan", rol_global: null }]);
    expect(await resolverUsuarioDeEmpresaTx(c, 7, 9)).toEqual({ nombre: "Heber Sitan", rol: null });
  });
});

describe("resolverSolicitanteOperacionesTx", () => {
  it("catálogo de roles habilitados como solicitante", () => {
    expect([...ROLES_SOLICITANTE_OPERACIONES]).toEqual(["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones"]);
  });

  it("devuelve null si el usuario existe pero su rol NO está en la lista de Operaciones", async () => {
    const c = conn([{ nombre: "Contadora", rol_global: "Contabilidad" }]);
    expect(await resolverSolicitanteOperacionesTx(c, 7, 6)).toBeNull();
  });

  it("devuelve {nombre, rol} si el usuario tiene un rol de Operaciones habilitado", async () => {
    const c = conn([{ nombre: "Mario Caal", rol_global: "Operaciones" }]);
    expect(await resolverSolicitanteOperacionesTx(c, 7, 5)).toEqual({ nombre: "Mario Caal", rol: "Operaciones" });
  });

  it("devuelve null si el usuario no pertenece a la empresa (delega en resolverUsuarioDeEmpresaTx)", async () => {
    const c = conn([]);
    expect(await resolverSolicitanteOperacionesTx(c, 7, 999)).toBeNull();
  });
});
