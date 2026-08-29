import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clientes/schema", () => ({ asegurarSchemaClientes: vi.fn() }));
vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn() }));

import { execute, query } from "@/lib/db";
import { crearCliente } from "@/lib/clientes/repository";

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
