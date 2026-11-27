// A4 — regresión de los TRES logins con la protección simulada (sin base): 400 por JSON inválido (B3), 401 genérico, 429 con Retry-After, 503 genérico si la protección
// no está disponible (sin verificar la contraseña ni crear sesión) y el camino feliz intacto. Además: guarda estática de que no hay otra vía que verifique credenciales.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-intentos", async (orig) => ({ ...(await orig<typeof import("./auth-intentos")>()), protegerLogin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ verificarCredenciales: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-auth", () => ({ verificarCredencialesColaborador: vi.fn() }));
vi.mock("@/lib/tms/cliente-usuarios", () => ({ verificarCredencialesCliente: vi.fn() }));
vi.mock("@/lib/session", () => ({ createSessionToken: vi.fn(async () => "t"), setSessionCookie: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ createColaboradorSessionToken: vi.fn(async () => "t"), setColaboradorSessionCookie: vi.fn() }));
vi.mock("@/lib/tms/cliente-portal-session", () => ({ createClienteSessionToken: vi.fn(async () => "t"), setClienteSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: vi.fn(async () => [{ id: 1, slug: "monaco", nombre: "Mónaco" }]) }));
vi.mock("@/lib/dominios", () => ({ homePorRol: vi.fn(() => "/e/monaco"), slugPorHost: vi.fn(() => null) }));

import { ErrorProteccionLogin, protegerLogin } from "@/lib/auth-intentos";
import { verificarCredenciales } from "@/lib/auth";
import { verificarCredencialesColaborador } from "@/lib/rrhh/colaborador-auth";
import { verificarCredencialesCliente } from "@/lib/tms/cliente-usuarios";
import { setSessionCookie } from "@/lib/session";
import { setColaboradorSessionCookie } from "@/lib/rrhh/colaborador-session";
import { setClienteSessionCookie } from "@/lib/tms/cliente-portal-session";
import { POST as staff } from "@/app/api/auth/login/route";
import { POST as colaborador } from "@/app/api/portal/auth/login/route";
import { POST as cliente } from "@/app/api/cliente-portal/auth/login/route";

const RUTAS = [
  { nombre: "staff", post: staff, alcance: "staff", cuerpo: { username: "ana", password: "x" }, ident: "ana", verificar: verificarCredenciales, cookie: setSessionCookie,
    usuario: { id: 1, username: "ana", rol: "Operaciones", nombre: "Ana", accesoTodas: false } },
  { nombre: "colaborador", post: colaborador, alcance: "colaborador", cuerpo: { username: "beto", password: "x" }, ident: "beto", verificar: verificarCredencialesColaborador, cookie: setColaboradorSessionCookie,
    usuario: { empleadoId: 2, empresaId: 1, empresaSlug: "monaco", nombre: "Beto", debeCambiarPassword: false } },
  { nombre: "cliente", post: cliente, alcance: "cliente", cuerpo: { email: "c@x.com", password: "x" }, ident: "c@x.com", verificar: verificarCredencialesCliente, cookie: setClienteSessionCookie,
    usuario: { usuarioClienteId: 3, empresaId: 1, clienteId: 4, nombre: "C", debeCambiarPassword: false } },
] as const;
const req = (body: string) => new Request("http://x/login", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.1" }, body });

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe.each(RUTAS)("login $nombre con la protección A4", (r) => {
  it("pasa el alcance, el identificador y las cabeceras a la protección y, con credenciales válidas, crea la sesión (200)", async () => {
    vi.mocked(protegerLogin).mockImplementation(async (_e, verificar) => ({ tipo: "ok", valor: await verificar() }));
    vi.mocked(r.verificar).mockResolvedValue(r.usuario as never);
    const res = await r.post(req(JSON.stringify(r.cuerpo)));
    expect(res.status).toBe(200);
    const [entrada] = vi.mocked(protegerLogin).mock.calls[0];
    expect(entrada.alcance).toBe(r.alcance); expect(entrada.identificador).toBe(r.ident); expect(entrada.headers.get("x-forwarded-for")).toBe("198.51.100.1");
    expect(r.verificar).toHaveBeenCalledTimes(1); expect(r.cookie).toHaveBeenCalledTimes(1);
  });
  it("credenciales inválidas → 401 con el mensaje genérico de siempre y sin sesión", async () => {
    vi.mocked(protegerLogin).mockResolvedValue({ tipo: "credenciales" });
    const res = await r.post(req(JSON.stringify(r.cuerpo)));
    expect(res.status).toBe(401); expect((await res.json()).error).toMatch(/incorrectos|inválidas/); expect(r.cookie).not.toHaveBeenCalled();
  });
  it("bloqueado → 429 con Retry-After y mensaje genérico (no dice si el usuario existe), sin verificar ni crear sesión", async () => {
    vi.mocked(protegerLogin).mockResolvedValue({ tipo: "bloqueado", retryAfterS: 42 });
    const res = await r.post(req(JSON.stringify(r.cuerpo)));
    expect(res.status).toBe(429); expect(res.headers.get("Retry-After")).toBe("42"); expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.json()).toEqual({ error: "Demasiados intentos. Intenta de nuevo más tarde." });
    expect(r.verificar).not.toHaveBeenCalled(); expect(r.cookie).not.toHaveBeenCalled();
  });
  it("protección no disponible (tabla ausente, error SQL, sin secreto) → 503 genérico con Retry-After, registra SOLO el código y no crea sesión", async () => {
    vi.mocked(protegerLogin).mockRejectedValue(Object.assign(new ErrorProteccionLogin("TABLA_INUTILIZABLE"), { cause: { code: "ER_NO_SUCH_TABLE", errno: 1146, message: "Table 'u1_x.auth_intentos_login' doesn't exist" } }));
    const res = await r.post(req(JSON.stringify(r.cuerpo)));
    expect(res.status).toBe(503); expect(res.headers.get("Retry-After")).toBe("60");
    const cuerpo = JSON.stringify(await res.json()); expect(cuerpo).not.toMatch(/auth_intentos|ER_|tabla|SQL|MySQL/i);
    const log = vi.mocked(console.error).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(log).toContain("TABLA_INUTILIZABLE"); expect(log).toContain("ER_NO_SUCH_TABLE"); expect(log).not.toMatch(/doesn't exist|ana|beto|c@x\.com|198\.51/);
    expect(r.cookie).not.toHaveBeenCalled();
  });
  it("B3: cuerpo que NO es JSON → 400 (no 500) y no llega a la protección", async () => {
    const res = await r.post(req("{no es json"));
    expect(res.status).toBe(400); expect(protegerLogin).not.toHaveBeenCalled();
  });
  it("campos vacíos → 400 sin tocar la protección (no cuenta como intento)", async () => {
    const vacio = Object.fromEntries(Object.keys(r.cuerpo).map((k) => [k, ""]));
    expect((await r.post(req(JSON.stringify(vacio)))).status).toBe(400); expect(protegerLogin).not.toHaveBeenCalled();
  });
});

describe("no hay vías alternativas para eludir el límite", () => {
  const src = path.resolve(__dirname, "..");
  const archivos: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const f = path.join(d, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) archivos.push(f); } };
  walk(src);
  const rel = (f: string) => path.relative(src, f).split(path.sep).join("/");
  it("las funciones de login por usuario/contraseña solo se usan desde las tres rutas, y cada ruta las invoca DENTRO de protegerLogin", () => {
    const usos = archivos.filter((f) => /\bverificarCredenciales(Colaborador|Cliente)?\s*\(/.test(readFileSync(f, "utf8")) && !/lib\/(auth|rrhh\/colaborador-auth|tms\/cliente-usuarios)\.ts$/.test(rel(f))).map(rel).sort();
    expect(usos).toEqual(["app/api/auth/login/route.ts", "app/api/cliente-portal/auth/login/route.ts", "app/api/portal/auth/login/route.ts"]);
    for (const f of usos) { const t = readFileSync(path.join(src, f), "utf8"); expect(t, f).toMatch(/protegerLogin\(\{ alcance: "(staff|colaborador|cliente)"[^]*?\(\) =>\s*verificarCredenciales/); }
  });
  it("verifyPassword fuera del módulo de contraseñas solo se usa en las funciones de login y en verificaciones con SESIÓN ya autenticada (cambio de contraseña, reautenticación de firma)", () => {
    const usos = archivos.filter((f) => /\bverifyPassword\s*\(/.test(readFileSync(f, "utf8")) && !rel(f).endsWith("lib/password.ts")).map(rel).sort();
    expect(usos).toEqual(["lib/auth.ts", "lib/rrhh/colaborador-auth.ts", "lib/tms/cliente-usuarios.ts"]);
  });
});
