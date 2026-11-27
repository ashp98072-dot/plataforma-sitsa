// A4 — piezas puras: configuración, normalización, HMAC, IP de origen, bloqueo progresivo y verificación ficticia (tiempo uniforme para identificadores inexistentes).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));

import { query } from "@/lib/db";
import { claveHmac, duracionBloqueoId, ErrorProteccionLogin, ipDeSolicitud, leerConfigIntentos, llavesDe, normalizarIdentificador, protegerLogin } from "./auth-intentos";
import * as password from "./password";
import { verificarCredenciales } from "./auth";
import { verificarCredencialesColaborador } from "./rrhh/colaborador-auth";
import { verificarCredencialesCliente } from "./tms/cliente-usuarios";

describe("configuración", () => {
  it("APAGADA por defecto; solo «1» la enciende; valores por defecto 5 / 30 / 15 min / bloqueo IP 5 min / tope 15 min", () => {
    expect(leerConfigIntentos({})).toMatchObject({ activa: false, idMax: 5, ipMax: 30, ventanaS: 900, bloqueoIdBaseS: 60, bloqueoIdMaxS: 900, bloqueoIpS: 300, retencionS: 86_400, maxFilas: 200_000 });
    expect(leerConfigIntentos({ AUTH_INTENTOS_PROTECCION: "true" }).activa).toBe(false);
    expect(leerConfigIntentos({ AUTH_INTENTOS_PROTECCION: "1" }).activa).toBe(true);
  });
  it("valores fuera de rango o no numéricos usan el predeterminado (no se puede desactivar el límite con 0 ni subirlo sin tope)", () => {
    expect(leerConfigIntentos({ AUTH_INTENTOS_ID_MAX: "0", AUTH_INTENTOS_IP_MAX: "999999", AUTH_INTENTOS_BLOQUEO_ID_MAX_S: "abc" })).toMatchObject({ idMax: 5, ipMax: 30, bloqueoIdMaxS: 900 });
  });
  it("sin secreto de al menos 32 caracteres no se calculan claves (falla cerrado)", () => {
    expect(() => llavesDe({ ...leerConfigIntentos({}), secreto: "corto" }, "cliente", "a", null)).toThrow(ErrorProteccionLogin);
  });
  it("con la protección APAGADA el login se comporta exactamente como antes (sin tocar la base)", async () => {
    const { getPool } = await import("@/lib/db");
    expect(await protegerLogin({ alcance: "staff", identificador: "a", headers: new Headers() }, async () => ({ id: 1 }), leerConfigIntentos({}))).toEqual({ tipo: "ok", valor: { id: 1 } });
    expect(await protegerLogin({ alcance: "staff", identificador: "a", headers: new Headers() }, async () => null, leerConfigIntentos({}))).toEqual({ tipo: "credenciales" });
    expect(getPool).not.toHaveBeenCalled();
  });
});

describe("identificador, HMAC e IP", () => {
  it("normaliza mayúsculas, espacios y formas Unicode equivalentes", () => {
    expect(normalizarIdentificador("  Juan.Pérez@Cliente.COM ")).toBe(normalizarIdentificador("juan.pérez@cliente.com"));
  });
  it("HMAC distinto por secreto, alcance y tipo; siempre 64 hex", () => {
    const a = claveHmac("s".repeat(32), ["login-id", "cliente", "x"]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(claveHmac("t".repeat(32), ["login-id", "cliente", "x"]));
    expect(a).not.toBe(claveHmac("s".repeat(32), ["login-id", "staff", "x"]));
    expect(a).not.toBe(claveHmac("s".repeat(32), ["login-ip", "cliente", "x"]));
  });
  it("IP: la ÚLTIMA de X-Forwarded-For (la del proxy más cercano), si no X-Real-IP; valores no IP o ausentes ⇒ null (no se agrupa a todos en un contador)", () => {
    expect(ipDeSolicitud(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(ipDeSolicitud(new Headers({ "x-real-ip": "2001:DB8::1" }))).toBe("2001:db8::1");
    expect(ipDeSolicitud(new Headers({ "x-forwarded-for": "<script>" }))).toBeNull();
    expect(ipDeSolicitud(new Headers())).toBeNull();
  });
  it("bloqueo progresivo: 60, 120, 240, 480, 900, 900 s", () => {
    const c = leerConfigIntentos({});
    expect([1, 2, 3, 4, 5, 9].map((n) => duracionBloqueoId(n, c))).toEqual([60, 120, 240, 480, 900, 900]);
  });
});

describe("tiempo uniforme: un identificador inexistente o inactivo ejecuta el MISMO scrypt que uno real", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it("verificacionFicticia siempre es false y cuesta lo mismo que verifyPassword con un hash scrypt real (orden de magnitud)", () => {
    const { salt, passwordHash } = password.hashPassword("clave-real");
    const medir = (fn: () => unknown) => { const t = performance.now(); for (let i = 0; i < 5; i++) fn(); return performance.now() - t; };
    const real = medir(() => password.verifyPassword("otra", salt, passwordHash)); const ficticia = medir(() => password.verificacionFicticia("otra"));
    expect(password.verificacionFicticia("cualquiera")).toBe(false);
    expect(ficticia / real).toBeGreaterThan(0.5); expect(ficticia / real).toBeLessThan(2);
  });
  it.each([
    ["staff", () => verificarCredenciales("no-existe", "x")],
    ["colaborador", () => verificarCredencialesColaborador("no-existe", "x")],
    ["cliente", () => verificarCredencialesCliente("no-existe@x.com", "x")],
  ])("%s: usuario inexistente ⇒ null tras una verificación ficticia (scrypt)", async (_n, fn) => {
    vi.mocked(query).mockResolvedValue([] as never);
    const espia = vi.spyOn(password, "verificacionFicticia");
    expect(await fn()).toBeNull();
    expect(espia).toHaveBeenCalledTimes(1);
  });
});
