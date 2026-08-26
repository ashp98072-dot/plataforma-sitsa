import { afterEach, describe, expect, it } from "vitest";
import { cifrarCredencial, descifrarCredencial } from "./credenciales";

const authAnterior = process.env.AUTH_SECRET;
const portalAnterior = process.env.PORTAL_CREDENTIALS_KEY;

afterEach(() => {
  if (authAnterior == null) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = authAnterior;
  if (portalAnterior == null) delete process.env.PORTAL_CREDENTIALS_KEY;
  else process.env.PORTAL_CREDENTIALS_KEY = portalAnterior;
});

describe("credenciales internas de proveedores", () => {
  it("cifra y descifra usando AUTH_SECRET sin una variable adicional", () => {
    process.env.AUTH_SECRET = "secreto-principal-pruebas-2026-seguro";
    delete process.env.PORTAL_CREDENTIALS_KEY;

    const cifrada = cifrarCredencial("clave-del-proveedor");

    expect(cifrada).not.toContain("clave-del-proveedor");
    expect(descifrarCredencial(cifrada)).toBe("clave-del-proveedor");
  });
});
