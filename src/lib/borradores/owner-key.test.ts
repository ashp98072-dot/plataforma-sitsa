import { describe, expect, it } from "vitest";
import { problemaAmbitoUsuarioEmpresa } from "./ambito";
import { calcularOwnerKey, ownerKeyDeUsuario, resolverSecretoPropietario } from "./owner-key";

// Secretos FICTICIOS de prueba (no son valores reales de ningún entorno).
const AUTH = "auth-secreto-de-prueba-0123456789-abcdef";
const DEDICADO = "dedicado-de-prueba-0123456789-abcdefghijkl-xyz";
const ENV = { AUTH_SECRET: AUTH };

describe("ownerKey: identidad estable y opaca", () => {
  it("el mismo usuario obtiene SIEMPRE el mismo ownerKey (inicios de sesión distintos, sin aleatoriedad)", () => {
    const a = ownerKeyDeUsuario(42, ENV);
    expect(a).not.toBeNull();
    for (let i = 0; i < 50; i++) expect(ownerKeyDeUsuario(42, ENV)).toBe(a);
    expect(ownerKeyDeUsuario(42, { ...ENV })).toBe(a); // otro «proceso» con el mismo secreto
  });

  it("usuarios distintos → ownerKey distintos (1 000 ids sin colisiones)", () => {
    const vistos = new Set<string>();
    for (let id = 1; id <= 1000; id++) vistos.add(ownerKeyDeUsuario(id, ENV)!);
    expect(vistos.size).toBe(1000);
  });

  it("no revela el id, el secreto ni el username, y no es reversible a simple vista", () => {
    const k = ownerKeyDeUsuario(1234567, ENV)!;
    expect(k).toMatch(/^o1_[A-Za-z0-9_-]{43}$/);
    expect(k).not.toContain("1234567");
    expect(k).not.toContain(AUTH);
    expect(k).not.toContain("admin");
  });

  it("es un identificador válido para el núcleo (mismas reglas de ámbito)", () => {
    expect(problemaAmbitoUsuarioEmpresa({ ownerKey: ownerKeyDeUsuario(7, ENV), empresaId: 1 })).toBeNull();
  });

  it("depende SOLO del id interno: no hay forma de pasar username/JWT (la firma acepta un número)", () => {
    expect(ownerKeyDeUsuario("admin", ENV)).toBeNull();
    expect(ownerKeyDeUsuario("42", ENV)).toBeNull();
    expect(ownerKeyDeUsuario({ id: 42 }, ENV)).toBeNull();
    expect(ownerKeyDeUsuario(undefined, ENV)).toBeNull();
    expect(ownerKeyDeUsuario(null, ENV)).toBeNull();
    for (const malo of [0, -1, 1.5, NaN, Infinity, 2 ** 60]) expect(ownerKeyDeUsuario(malo, ENV)).toBeNull();
    expect(() => calcularOwnerKey(0, AUTH)).toThrow(RangeError);
  });

  it("el dominio está separado del secreto de sesión: no es un HMAC/hash trivial del id con AUTH_SECRET", async () => {
    const { createHmac, createHash } = await import("node:crypto");
    const k = ownerKeyDeUsuario(9, ENV)!;
    const ingenuo = "o1_" + createHmac("sha256", AUTH).update("usuario:9").digest("base64url");
    const hash = "o1_" + createHash("sha256").update(AUTH + "9").digest("base64url");
    expect(k).not.toBe(ingenuo);
    expect(k).not.toBe(hash);
  });
});

describe("ownerKey: fuente del secreto", () => {
  it("sin ningún secreto adecuado NO hay ownerKey (función desactivada; nunca un valor efímero ni público)", () => {
    expect(ownerKeyDeUsuario(1, {})).toBeNull();
    expect(ownerKeyDeUsuario(1, { AUTH_SECRET: "" })).toBeNull();
    expect(ownerKeyDeUsuario(1, { AUTH_SECRET: "corto" })).toBeNull();
    expect(resolverSecretoPropietario({})).toBeNull();
  });

  it("rechaza los secretos públicos conocidos (desarrollo y ejemplos de despliegue)", () => {
    for (const publico of ["dev-insecure-secret-change-me-32", "cambia-este-secreto-largo-aleatorio", "secreto-largo-aleatorio-min-16"]) {
      expect(ownerKeyDeUsuario(1, { AUTH_SECRET: publico })).toBeNull();
      expect(ownerKeyDeUsuario(1, { BORRADORES_OWNER_SECRET: publico.padEnd(40, "x"), AUTH_SECRET: AUTH })).not.toBeNull(); // el padding ya no es el valor público
    }
  });

  it("BORRADORES_OWNER_SECRET (opcional) tiene prioridad y desacopla el ownerKey de AUTH_SECRET", () => {
    const conDedicado = ownerKeyDeUsuario(5, { AUTH_SECRET: AUTH, BORRADORES_OWNER_SECRET: DEDICADO });
    expect(conDedicado).not.toBe(ownerKeyDeUsuario(5, ENV));
    // Rotar AUTH_SECRET NO cambia el ownerKey cuando hay secreto dedicado.
    expect(ownerKeyDeUsuario(5, { AUTH_SECRET: "otro-auth-secret-rotado-0123456789", BORRADORES_OWNER_SECRET: DEDICADO })).toBe(conDedicado);
  });

  it("un secreto dedicado inválido NO cae en silencio a AUTH_SECRET (eso rotaría las claves sin aviso)", () => {
    expect(ownerKeyDeUsuario(5, { AUTH_SECRET: AUTH, BORRADORES_OWNER_SECRET: "demasiado-corto" })).toBeNull();
  });

  it("rotar AUTH_SECRET (sin dedicado) cambia TODOS los ownerKey: documentado como implicación de la rotación", () => {
    expect(ownerKeyDeUsuario(5, ENV)).not.toBe(ownerKeyDeUsuario(5, { AUTH_SECRET: "auth-rotado-0123456789-abcdefghijk" }));
  });

  it("no filtra el secreto en ningún valor devuelto ni en errores", () => {
    let mensaje = "";
    try { calcularOwnerKey(-1, AUTH); } catch (e) { mensaje = String((e as Error).message); }
    expect(mensaje).not.toContain(AUTH);
    expect(JSON.stringify(ownerKeyDeUsuario(3, ENV))).not.toContain(AUTH);
  });
});
