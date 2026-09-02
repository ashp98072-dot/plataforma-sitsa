import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  execute: vi.fn(),
  query: vi.fn(),
}));

import { execute, query } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  activarUsuarioCliente,
  cambiarPasswordCliente,
  crearUsuarioCliente,
  normalizarEmail,
  resetearPasswordUsuarioCliente,
  validarClienteSessionActiva,
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

  it("7b) ER_DUP_ENTRY en el INSERT (carrera con otra alta simultánea del mismo email) → error funcional, NO una excepción/500", async () => {
    // El SELECT optimista de "¿email libre?" no lo detecta (otra alta
    // ganó la carrera justo después) — el UNIQUE KEY de la base de datos
    // es quien realmente lo impide, en el INSERT.
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 30 }] as unknown as Awaited<ReturnType<typeof query>>) // cliente existe
      .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>); // "libre" según el SELECT
    vi.mocked(execute).mockRejectedValueOnce({ code: "ER_DUP_ENTRY", errno: 1062 });

    const r = await crearUsuarioCliente({
      empresaId: 7,
      clienteId: 30,
      nombre: "Carrera",
      email: "contacto@cliente.com",
      passwordInicial: "temporal1",
      creadoPor: "operaciones1",
    });
    expect(r).toEqual({ ok: false, mensaje: "Ese email ya está en uso." });
  });

  it("un error de base de datos distinto a ER_DUP_ENTRY SÍ se propaga (no se convierte en 'ya está en uso')", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 30 }] as unknown as Awaited<ReturnType<typeof query>>)
      .mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    vi.mocked(execute).mockRejectedValueOnce({ code: "ER_LOCK_DEADLOCK" });

    await expect(
      crearUsuarioCliente({
        empresaId: 7,
        clienteId: 30,
        nombre: "Otro",
        email: "otro2@cliente.com",
        passwordInicial: "temporal1",
        creadoPor: "operaciones1",
      }),
    ).rejects.toMatchObject({ code: "ER_LOCK_DEADLOCK" });
  });
});

describe("cambiarPasswordCliente", () => {
  const scope = { usuarioClienteId: 10, empresaId: 7, clienteId: 30 };

  it("9) cambio de password exitoso limpia debe_cambiar_password", async () => {
    const { salt, passwordHash } = hashPassword("actual123");
    vi.mocked(query).mockResolvedValueOnce(
      [{ id: 10, salt, password_hash: passwordHash }] as unknown as Awaited<
        ReturnType<typeof query>
      >,
    );
    const r = await cambiarPasswordCliente(scope, "actual123", "nueva123");
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
    const r = await cambiarPasswordCliente(scope, "incorrecta", "nueva123");
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("6) scope inválido (empresaId/clienteId no coinciden con el usuario) → 'Usuario no encontrado', sin UPDATE — el SELECT filtra por los 3 identificadores, no solo por id", async () => {
    // Simula lo que devolvería MySQL si el WHERE id=? AND empresa_id=? AND
    // cliente_id=? no encuentra fila porque empresaId/clienteId no
    // coinciden con la fila real del usuario 10 (que es de otra empresa).
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await cambiarPasswordCliente(
      { usuarioClienteId: 10, empresaId: 999, clienteId: 999 },
      "actual123",
      "nueva123",
    );
    expect(r).toEqual({ ok: false, mensaje: "Usuario no encontrado." });
    expect(execute).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND empresa_id = ? AND cliente_id = ?"),
      [10, 999, 999],
    );
  });
});

describe("validarClienteSessionActiva", () => {
  const scope = { usuarioClienteId: 10, empresaId: 7, clienteId: 30 };

  it("1) usuario activo + cliente activo + identificadores correctos → true", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      [{ id: 10 }] as unknown as Awaited<ReturnType<typeof query>>,
    );
    expect(await validarClienteSessionActiva(scope)).toBe(true);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("u.activo = 1");
    expect(String(sql)).toContain("c.estado = 'Activo'");
    expect(params).toEqual([10, 7, 30, 30, 7]);
  });

  it("2) usuario desactivado después del login (WHERE u.activo=1 ya no encuentra la fila) → false", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    expect(await validarClienteSessionActiva(scope)).toBe(false);
  });

  it("3) cliente desactivado después del login (WHERE c.estado='Activo' ya no encuentra la fila) → false", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    expect(await validarClienteSessionActiva(scope)).toBe(false);
  });

  it("4) usuarioClienteId correcto pero empresaId incorrecto → false", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    expect(
      await validarClienteSessionActiva({ usuarioClienteId: 10, empresaId: 999, clienteId: 30 }),
    ).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.any(String), [10, 999, 30, 30, 999]);
  });

  it("5) usuarioClienteId correcto pero clienteId incorrecto → false", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof query>>);
    expect(
      await validarClienteSessionActiva({ usuarioClienteId: 10, empresaId: 7, clienteId: 999 }),
    ).toBe(false);
    expect(query).toHaveBeenCalledWith(expect.any(String), [10, 7, 999, 999, 7]);
  });
});

// CLIENTE-PORTAL-1C — activarUsuarioCliente/resetearPasswordUsuarioCliente
// ahora exigen también clienteId en el WHERE (alcance 7/8 del ticket: toda
// mutación valida empresa + cliente + que el usuario pertenezca a ese
// cliente), no solo empresaId.
describe("activarUsuarioCliente", () => {
  it("desactiva un usuario que sí pertenece a ese cliente", async () => {
    vi.mocked(execute).mockResolvedValueOnce({
      affectedRows: 1,
    } as unknown as Awaited<ReturnType<typeof execute>>);
    const r = await activarUsuarioCliente(7, 30, 10, false);
    expect(r).toEqual({ ok: true, mensaje: "Acceso desactivado." });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND empresa_id = ? AND cliente_id = ?"),
      [0, 10, 7, 30],
    );
  });

  it("usuario existe pero pertenece a OTRO cliente → 0 filas afectadas, tratado como no encontrado", async () => {
    // Simula lo que MySQL devolvería si el usuario #10 es real pero su
    // cliente_id no coincide con el cliente_id pasado (999): el WHERE no
    // encuentra fila, exactamente igual que si el id no existiera.
    vi.mocked(execute).mockResolvedValueOnce({
      affectedRows: 0,
    } as unknown as Awaited<ReturnType<typeof execute>>);
    const r = await activarUsuarioCliente(7, 999, 10, false);
    expect(r).toEqual({ ok: false, mensaje: "Usuario no encontrado para este cliente." });
  });
});

describe("resetearPasswordUsuarioCliente", () => {
  it("reinicia la contraseña de un usuario que sí pertenece a ese cliente", async () => {
    vi.mocked(execute).mockResolvedValueOnce({
      affectedRows: 1,
    } as unknown as Awaited<ReturnType<typeof execute>>);
    const r = await resetearPasswordUsuarioCliente(7, 30, 10, "temporal1");
    expect(r).toEqual({ ok: true, mensaje: "Contraseña reiniciada." });
    const call = vi.mocked(execute).mock.calls[0];
    expect(String(call[0])).toContain("WHERE id = ? AND empresa_id = ? AND cliente_id = ?");
    expect(call[1]).toEqual([expect.any(String), expect.any(String), 10, 7, 30]);
  });

  it("usuario de OTRO cliente → rechazado, sin filtrar solo por empresa", async () => {
    vi.mocked(execute).mockResolvedValueOnce({
      affectedRows: 0,
    } as unknown as Awaited<ReturnType<typeof execute>>);
    const r = await resetearPasswordUsuarioCliente(7, 999, 10, "temporal1");
    expect(r).toEqual({ ok: false, mensaje: "Usuario no encontrado para este cliente." });
  });

  it("contraseña nueva corta → rechazada antes de tocar la base de datos", async () => {
    const r = await resetearPasswordUsuarioCliente(7, 30, 10, "abc");
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
