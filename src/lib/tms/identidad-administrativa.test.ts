import { describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import {
  CODIGOS_ENTIDAD_REQUIRIENTE,
  ROLES_SOLICITANTE_OPERACIONES,
  resolverEntidadRequirenteTx,
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
