import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/session", () => ({ clearSessionCookie: vi.fn() }));

import { NextResponse } from "next/server";
import { execute, query } from "@/lib/db";
import { requireSession } from "@/lib/api-guard";
import { clearSessionCookie } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { POST } from "./route";

/**
 * MENÚ DE CUENTA — POST /api/auth/cambiar-password. Lógica REAL de lib/auth.ts + lib/password.ts (scrypt); solo se
 * simulan la BD y la sesión. El usuario sale de la sesión, nunca del cuerpo.
 */
const ACTUAL = "Actual123";
const NUEVA = "Nueva456!";
const guardado = hashPassword(ACTUAL);
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/auth/cambiar-password", { method: "POST", body: JSON.stringify(body) }));
const valido = { passwordActual: ACTUAL, passwordNueva: NUEVA, confirmarPassword: NUEVA };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 7, username: "walter", rol: "Admin" } } as never);
  vi.mocked(query).mockResolvedValue([{ password_hash: guardado.passwordHash, salt: guardado.salt }] as never);
  vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
});

describe("POST /api/auth/cambiar-password", () => {
  it("sin sesión: 401 y no toca la BD", async () => {
    vi.mocked(requireSession).mockResolvedValue({ error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) } as never);
    const res = await post(valido);
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("cambio exitoso: guarda scrypt nuevo SOLO para el usuario de la sesión y cierra la sesión", async () => {
    const res = await post(valido);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/login" });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7]);
    const [sql, params] = vi.mocked(execute).mock.calls[0] as [string, unknown[]];
    expect(sql).toBe("UPDATE usuarios SET password_hash = ?, salt = ? WHERE id = ? AND activo = 1 AND password_hash = ?");
    const [hashNuevo, saltNuevo, id, hashAnterior] = params as [string, string, number, string];
    expect(id).toBe(7);
    expect(hashAnterior).toBe(guardado.passwordHash);
    expect(hashNuevo).toHaveLength(128); // scrypt keylen 64 en hex, mismo algoritmo del sistema
    expect(verifyPassword(NUEVA, saltNuevo, hashNuevo)).toBe(true);
    expect(verifyPassword(ACTUAL, saltNuevo, hashNuevo)).toBe(false);
    expect(clearSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("contraseña actual incorrecta: 400 genérico, sin UPDATE y sin cerrar sesión", async () => {
    const res = await post({ ...valido, passwordActual: "otra" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Verifica tu contraseña actual/);
    expect(execute).not.toHaveBeenCalled();
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });

  it("confirmación que no coincide: 400 sin consultar la BD", async () => {
    const res = await post({ ...valido, confirmarPassword: "distinta1" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/confirmación no coincide/);
    expect(query).not.toHaveBeenCalled();
  });

  it("nueva igual a la actual o demasiado corta: 400", async () => {
    expect((await post({ passwordActual: ACTUAL, passwordNueva: ACTUAL, confirmarPassword: ACTUAL })).status).toBe(400);
    expect((await post({ passwordActual: ACTUAL, passwordNueva: "abc", confirmarPassword: "abc" })).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("solo puede cambiar SU PROPIA contraseña: un id/username en el cuerpo se rechaza (esquema estricto)", async () => {
    for (const extra of [{ usuarioId: 99 }, { id: 99 }, { username: "otro" }]) {
      const res = await post({ ...valido, ...extra });
      expect(res.status).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("usuario inactivo/inexistente: mismo mensaje genérico", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const res = await post(valido);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Verifica tu contraseña actual/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("si el hash cambió entre la lectura y la escritura (0 filas) no se reporta éxito ni se cierra la sesión", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as never);
    const res = await post(valido);
    expect(res.status).toBe(400);
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });

  it("nunca devuelve el hash/salt ni registra contraseñas, ni siquiera ante un error de BD", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(execute).mockRejectedValue(Object.assign(new Error(`fallo con ${NUEVA}`), { sql: `UPDATE ... ${guardado.passwordHash}` }));
    const res = await post(valido);
    expect(res.status).toBe(500);
    const texto = JSON.stringify(await res.json());
    const logs = JSON.stringify(log.mock.calls);
    for (const secreto of [ACTUAL, NUEVA, guardado.passwordHash, guardado.salt]) {
      expect(texto).not.toContain(secreto);
      expect(logs).not.toContain(secreto);
    }
    log.mockRestore();

    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
    expect(JSON.stringify(await (await post(valido)).json())).not.toMatch(/hash|salt/i);
  });

  it("JSON inválido: 400", async () => {
    const res = await POST(new Request("http://localhost/api/auth/cambiar-password", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });
});
