import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  execute: vi.fn(),
  query: vi.fn(),
}));

import { execute, query } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  cambiarPasswordCliente,
  crearUsuarioCliente,
  normalizarEmail,
  verificarCredencialesCliente,
} from "./cliente-usuarios";

function filaUsuario(overrides: Record<string, unknown> = {}) {
  const { salt, passwordHash } = hashPassword("clave-correcta");
  return {
    id: 10,
    empresa_id: 7,
    cliente_id: 30,
    nombre: "Logística ACME",
    password_hash: passwordHash,
    salt,
    activo: 1,
    debe_cambiar_password: 0,
    cliente_estado: "Activo",
    ...overrides,
  };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("normalizarEmail", () => {
  it("recorta espacios y baja a minúsculas", () => {
    expect(normalizarEmail("  Contacto@Cliente.COM ")).toBe("contacto@cliente.com");
  });
});

describe("verificarCredencialesCliente", () => {
  it("1) password correcto → devuelve datos de sesión y actualiza ultimo_acceso", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [filaUsuario()] as unknown as Awaited<ReturnType<typeof query>>,
    );
    const r = await verificarCredencialesCliente("contacto@cliente.com", "clave-correcta");
    expect(r).toEqual({
      usuarioClienteId: 10,
      empresaId: 7,
      clienteId: 30,
      nombre: "Logística ACME",
      debeCambiarPassword: false,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("ultimo_acceso = NOW()"),
      [10],
    );
  });

  it("2) password incorrecto → null, y NO actualiza ultimo_acceso", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [filaUsuario()] as unknown as Awaited<ReturnType<typeof query>>,
    );
    const r = await verificarCredencialesCliente("contacto@cliente.com", "clave-mala");
    expect(r).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("3) usuario inactivo (activo=0) → null aunque la contraseña sea correcta", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [filaUsuario({ activo: 0 })] as unknown as Awaited<ReturnType<typeof query>>,
    );
    const r = await verificarCredencialesCliente("contacto@cliente.com", "clave-correcta");
    expect(r).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("4) cliente TMS inactivo → null aunque el usuario esté activo y la contraseña sea correcta", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [filaUsuario({ cliente_estado: "Inactivo" })] as unknown as Awaited<
        ReturnType<typeof query>
      >,
    );
    const r = await verificarCredencialesCliente("contacto@cliente.com", "clave-correcta");
    expect(r).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("email inexistente → null (mismo resultado que password incorrecta, sin distinción)", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await verificarCredencialesCliente("nadie@cliente.com", "cualquiera");
    expect(r).toBeNull();
  });

  it("8) debeCambiarPassword=true se propaga a la sesión", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [filaUsuario({ debe_cambiar_password: 1 })] as unknown as Awaited<
        ReturnType<typeof query>
      >,
    );
    const r = await verificarCredencialesCliente("contacto@cliente.com", "clave-correcta");
    expect(r?.debeCambiarPassword).toBe(true);
  });
});

describe("crearUsuarioCliente", () => {
  it("6) varios usuarios pueden pertenecer al mismo cliente — no exige 'exactamente uno' como colaborador_credenciales", async () => {
    // Cliente encontrado, email libre, INSERT ok, SELECT final devuelve la fila.
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 30 }] as unknown as Awaited<ReturnType<typeof query>>) // cliente existe
      .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>) // email libre
      .mockResolvedValueOnce(
        [filaUsuario({ id: 11, nombre: "Segundo contacto" })] as unknown as Awaited<
          ReturnType<typeof query>
        >,
      );
    vi.mocked(execute).mockResolvedValueOnce({
      insertId: 11,
      affectedRows: 1,
    } as unknown as Awaited<ReturnType<typeof execute>>);

    const r = await crearUsuarioCliente({
      empresaId: 7,
      clienteId: 30,
      nombre: "Segundo contacto",
      email: "segundo@cliente.com",
      passwordInicial: "temporal1",
      creadoPor: "operaciones1",
    });
    expect(r.ok).toBe(true);
    // La única consulta de unicidad es por email — nunca se pregunta "¿ya
    // tiene una credencial este cliente?" (a diferencia de
    // crearCredencialColaborador, que sí lo hace por empleado).
    const llamadas = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    expect(llamadas.some((sql) => /tms_cliente_usuarios WHERE email/.test(sql))).toBe(true);
    expect(llamadas.some((sql) => /ya tiene/i.test(sql))).toBe(false);
  });

  it("7) email duplicado → rechazado con mensaje, sin INSERT", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 30 }] as unknown as Awaited<ReturnType<typeof query>>)
      .mockResolvedValueOnce(
        [{ id: 99 }] as unknown as Awaited<ReturnType<typeof query>>,
      ); // email ya en uso
    const r = await crearUsuarioCliente({
      empresaId: 7,
      clienteId: 30,
      nombre: "Otro",
      email: "contacto@cliente.com",
      passwordInicial: "temporal1",
      creadoPor: "operaciones1",
    });
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("cliente_id que no pertenece a la empresa → rechazado (aislamiento empresa)", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await crearUsuarioCliente({
      empresaId: 7,
      clienteId: 999,
      nombre: "Otro",
      email: "otro@cliente.com",
      passwordInicial: "temporal1",
      creadoPor: "operaciones1",
    });
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("cambiarPasswordCliente", () => {
  it("9) cambio de password exitoso limpia debe_cambiar_password", async () => {
    const { salt, passwordHash } = hashPassword("actual123");
    vi.mocked(query).mockResolvedValueOnce(
      [{ id: 10, salt, password_hash: passwordHash }] as unknown as Awaited<
        ReturnType<typeof query>
      >,
    );
    const r = await cambiarPasswordCliente(10, "actual123", "nueva123");
    expect(r.ok).toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("debe_cambiar_password = 0"),
      expect.any(Array),
    );
  });

  it("contraseña actual incorrecta → rechazado, sin UPDATE", async () => {
    const { salt, passwordHash } = hashPassword("actual123");
    vi.mocked(query).mockResolvedValueOnce(
      [{ id: 10, salt, password_hash: passwordHash }] as unknown as Awaited<
        ReturnType<typeof query>
      >,
    );
    const r = await cambiarPasswordCliente(10, "incorrecta", "nueva123");
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
