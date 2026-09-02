import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientes/schema", () => ({ asegurarSchemaClientes: vi.fn() }));
vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn() }));

import { execute, query } from "@/lib/db";
import { crearCliente, resolverTmsClienteId } from "@/lib/clientes/repository";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(execute).mockImplementation(async (sql) => {
    const statement = String(sql);
    if (statement.includes("INSERT INTO tms_clientes")) return { insertId: 33 } as Awaited<ReturnType<typeof execute>>;
    if (statement.includes("INSERT INTO clientes")) return { insertId: 44 } as Awaited<ReturnType<typeof execute>>;
    return { affectedRows: 1 } as Awaited<ReturnType<typeof execute>>;
  });
  vi.mocked(query).mockResolvedValue([{
    id: 44,
    empresa_id: 7,
    codigo: "CLI-000044",
    nombre: "Cliente nuevo",
    razon_social: null,
    nit: null,
    rtu: "RTU-44",
    telefono: null,
    email: null,
    direccion: null,
    contacto_nombre: null,
    contacto_telefono: null,
    tipo: "comercial",
    estado: "Activo",
    notas: null,
    tms_cliente_id: 33,
    creado_at: null,
    actualizado_at: null,
  }] as never);
});

describe("crearCliente", () => {
  it("genera el código después de insertar cuando se dejó vacío", async () => {
    const cliente = await crearCliente(7, { nombre: "Cliente nuevo", codigo: null, rtu: "RTU-44" });
    expect(cliente.codigo).toBe("CLI-000044");
    expect(execute).toHaveBeenCalledWith(
      "UPDATE clientes SET codigo = ? WHERE id = ? AND empresa_id = ? AND codigo IS NULL",
      ["CLI-000044", 44, 7],
    );
  });

  it("respeta el código ingresado y no lo reemplaza", async () => {
    await crearCliente(7, { nombre: "Cliente nuevo", codigo: "KT-CLIENTE-1" });
    expect(vi.mocked(execute).mock.calls.some(([sql]) => String(sql).startsWith("UPDATE clientes SET codigo"))).toBe(false);
  });
});

function filaCliente(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    empresa_id: 101,
    codigo: "CLI-000005",
    nombre: "Cliente X",
    razon_social: null,
    nit: null,
    rtu: null,
    telefono: null,
    email: null,
    direccion: null,
    contacto_nombre: null,
    contacto_telefono: null,
    tipo: "comercial",
    estado: "Activo",
    notas: null,
    tms_cliente_id: null,
    creado_at: null,
    actualizado_at: null,
    ...overrides,
  };
}

// CLIENTE-PORTAL-1C — resolverTmsClienteId. Cada caso usa un empresaId
// distinto porque asegurarVinculosTmsClientes memoiza por empresa
// (vinculosReady) a nivel de módulo — reutilizar el mismo empresaId
// entre tests haría que el segundo test se saltara la consulta real.
describe("resolverTmsClienteId", () => {
  it("cliente ya sincronizado (tms_cliente_id presente) → ok sin tocar el mecanismo de backfill", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [filaCliente({ empresa_id: 200, tms_cliente_id: 77 })] as never,
    );
    const r = await resolverTmsClienteId(200, 5);
    expect(r).toEqual({
      ok: true,
      tmsClienteId: 77,
      cliente: expect.objectContaining({ id: 5, tmsClienteId: 77 }),
    });
    // Solo 1 SELECT (el de obtenerCliente) — nunca llega a consultar
    // "clientes sin tms_cliente_id" porque no hace falta backfill.
    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("cliente sin sincronizar pero el backfill lo resuelve → ok", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([filaCliente({ empresa_id: 201 })] as never) // obtenerCliente inicial
      .mockResolvedValueOnce([filaCliente({ empresa_id: 201 })] as never) // asegurarVinculosTmsClientes: SELECT ... WHERE tms_cliente_id IS NULL
      .mockResolvedValueOnce(
        [filaCliente({ empresa_id: 201, tms_cliente_id: 88 })] as never,
      ); // obtenerCliente final, ya con el vínculo
    vi.mocked(execute).mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes("INSERT INTO tms_clientes")) {
        return { insertId: 88 } as Awaited<ReturnType<typeof execute>>;
      }
      return { affectedRows: 1 } as Awaited<ReturnType<typeof execute>>;
    });
    const r = await resolverTmsClienteId(201, 5);
    expect(r).toEqual({
      ok: true,
      tmsClienteId: 88,
      cliente: expect.objectContaining({ id: 5, tmsClienteId: 88 }),
    });
  });

  it("cliente inexistente → 'Cliente no encontrado.'", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    const r = await resolverTmsClienteId(202, 999);
    expect(r).toEqual({ ok: false, mensaje: "Cliente no encontrado." });
    expect(execute).not.toHaveBeenCalled();
  });

  it("cliente sin sincronizar y el backfill tampoco lo resuelve (ej. cliente Inactivo) → mensaje claro, no un resolver ambiguo", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([filaCliente({ empresa_id: 203 })] as never) // obtenerCliente inicial
      .mockResolvedValueOnce([] as never) // asegurarVinculosTmsClientes no encuentra nada que vincular
      .mockResolvedValueOnce([filaCliente({ empresa_id: 203 })] as never); // obtenerCliente final, sigue sin vínculo
    const r = await resolverTmsClienteId(203, 5);
    expect(r).toEqual({
      ok: false,
      mensaje: "Este cliente todavía no está sincronizado con TMS.",
    });
  });
});
