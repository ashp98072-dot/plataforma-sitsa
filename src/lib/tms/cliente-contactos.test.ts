import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
import { execute, query } from "@/lib/db";
import { actualizarContactoCliente, buscarPosiblesDuplicadosContacto, crearContactoCliente, eliminarContactoClienteSinUso, listarContactosCliente } from "./cliente-contactos";

beforeEach(()=>vi.clearAllMocks());

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§7/§8 del ticket) — "+ Agregar contacto"
 * guarda en la base REAL del cliente (nunca solo dentro de la ruta) y
 * queda disponible de inmediato en listarContactosCliente; antes de
 * crear, se advierte (nunca bloquea) un posible duplicado por email o
 * teléfono del MISMO cliente — jamás por nombre solo.
 */

function fila(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, cliente_id: 5, nombre: "Ana Gómez", cargo: "Compras", telefono: "5555-1111",
    email: "ana@cliente.com", observaciones: null, activo: 1,
    ...overrides,
  };
}

describe("crearContactoCliente — queda disponible en el cliente real (§7 del ticket)", () => {
  it("inserta en tms_cliente_contactos (la base real del cliente) y el contacto creado es legible de inmediato", async () => {
    vi.mocked(execute).mockResolvedValue({ insertId: 10, affectedRows: 1 } as never);
    vi.mocked(query).mockResolvedValue([fila({ id: 10, nombre: "Ana Gómez" })] as never);
    const contacto = await crearContactoCliente(7, 5, { nombre: "Ana Gómez", cargo: "Compras", telefono: "5555-1111", email: "ana@cliente.com" });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tms_cliente_contactos"),
      [7, 5, "Ana Gómez", "Compras", "5555-1111", "ana@cliente.com", null],
    );
    expect(contacto.id).toBe(10);
    expect(contacto.clienteId).toBe(5);
  });

  it("después de crear, listarContactosCliente (mismo empresa+cliente) lo incluiría — misma tabla, sin copia paralela", async () => {
    vi.mocked(query).mockResolvedValue([fila()] as never);
    const contactos = await listarContactosCliente(7, 5);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("FROM tms_cliente_contactos");
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, 5]);
    expect(contactos[0].nombre).toBe("Ana Gómez");
  });

  it("rechaza nombre vacío", async () => {
    await expect(crearContactoCliente(7, 5, { nombre: "   " })).rejects.toThrow("Nombre del contacto requerido.");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("administración y conservación histórica",()=>{
  it("listar administración incluye activos e inactivos del mismo tenant/cliente",async()=>{vi.mocked(query).mockResolvedValue([fila(),fila({id:2,activo:0})] as never);const r=await listarContactosCliente(7,5,{incluirInactivos:true});expect(r).toHaveLength(2);const [sql,params]=vi.mocked(query).mock.calls[0];expect(sql).not.toContain("activo = 1");expect(params).toEqual([7,5]);});
  it("editar/desactivar conserva la fila y acota por empresa",async()=>{vi.mocked(query).mockResolvedValueOnce([fila()] as never).mockResolvedValueOnce([fila({activo:0})] as never);await actualizarContactoCliente(7,1,{activo:false});expect(execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE tms_cliente_contactos"),expect.arrayContaining([1,7]));expect(execute).not.toHaveBeenCalledWith(expect.stringContaining("DELETE"),expect.anything());});
  it("bloquea eliminación si una ruta usa el contacto",async()=>{vi.mocked(query).mockResolvedValueOnce([{id:1}] as never).mockResolvedValueOnce([{id:9}] as never);await expect(eliminarContactoClienteSinUso(7,5,1)).resolves.toEqual({ok:false,motivo:"UTILIZADO"});expect(execute).not.toHaveBeenCalled();});
  it("elimina definitivamente solo si no tiene uso y conserva aislamiento",async()=>{vi.mocked(query).mockResolvedValueOnce([{id:1}] as never).mockResolvedValueOnce([] as never);await expect(eliminarContactoClienteSinUso(7,5,1)).resolves.toEqual({ok:true});expect(execute).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM tms_cliente_contactos"),[1,7,5]);});
});

describe("buscarPosiblesDuplicadosContacto (§8 del ticket)", () => {
  it("mismo cliente + mismo email -> advierte (coincidencia encontrada)", async () => {
    vi.mocked(query).mockResolvedValue([fila({ email: "ana@cliente.com" })] as never);
    const posibles = await buscarPosiblesDuplicadosContacto(7, 5, { email: "ANA@CLIENTE.COM", telefono: null });
    expect(posibles).toHaveLength(1);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("cliente_id = ?");
    expect(sql).toContain("activo = 1");
  });

  it("mismo cliente + mismo teléfono -> advierte", async () => {
    vi.mocked(query).mockResolvedValue([fila({ telefono: "5555-1111" })] as never);
    const posibles = await buscarPosiblesDuplicadosContacto(7, 5, { email: null, telefono: "5555-1111" });
    expect(posibles).toHaveLength(1);
  });

  it("sin email ni teléfono en el input -> nunca consulta nada (no se puede comparar solo por nombre)", async () => {
    const posibles = await buscarPosiblesDuplicadosContacto(7, 5, { email: null, telefono: null });
    expect(posibles).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("nombre igual pero email/teléfono distintos -> NO se marca como duplicado (nunca bloquea solo por nombre)", async () => {
    vi.mocked(query).mockResolvedValue([] as never); // el WHERE por email/teléfono no encuentra nada
    const posibles = await buscarPosiblesDuplicadosContacto(7, 5, { email: "otro@cliente.com", telefono: "5555-9999" });
    expect(posibles).toEqual([]);
  });

  it("AISLAMIENTO: la consulta siempre incluye empresa_id y cliente_id — un contacto de otro cliente/empresa nunca puede calzar por accidente", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await buscarPosiblesDuplicadosContacto(9, 42, { email: "x@x.com", telefono: null });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("empresa_id = ? AND cliente_id = ?");
    expect(params).toEqual([9, 42, "x@x.com"]);
  });
});
