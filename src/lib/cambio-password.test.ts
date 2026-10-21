import { describe, expect, it } from "vitest";
import { PASSWORD_MIN, validarCambioPassword } from "./cambio-password";

/** MENÚ DE CUENTA — reglas del formulario "Cambiar contraseña" (las aplica la página y de nuevo el servidor). */
const ok = { passwordActual: "Actual123", passwordNueva: "Nueva456", confirmarPassword: "Nueva456" };

describe("validarCambioPassword", () => {
  it("datos válidos -> null", () => expect(validarCambioPassword(ok)).toBeNull());
  it("contraseña actual obligatoria", () => expect(validarCambioPassword({ ...ok, passwordActual: "" })).toMatch(/actual/));
  it("nueva obligatoria", () => expect(validarCambioPassword({ ...ok, passwordNueva: "", confirmarPassword: "" })).toMatch(/nueva contraseña/));
  it(`mínimo ${PASSWORD_MIN} caracteres (misma política que los portales)`, () => {
    expect(PASSWORD_MIN).toBe(6);
    expect(validarCambioPassword({ ...ok, passwordNueva: "12345", confirmarPassword: "12345" })).toMatch(/al menos 6/);
    expect(validarCambioPassword({ ...ok, passwordNueva: "123456", confirmarPassword: "123456" })).toBeNull();
  });
  it("máximo razonable", () => {
    const largo = "x".repeat(129);
    expect(validarCambioPassword({ ...ok, passwordNueva: largo, confirmarPassword: largo })).toMatch(/superar/);
  });
  it("la confirmación debe coincidir", () => expect(validarCambioPassword({ ...ok, confirmarPassword: "otra" })).toMatch(/no coincide/));
  it("la nueva debe ser distinta a la actual", () =>
    expect(validarCambioPassword({ passwordActual: "Igual123", passwordNueva: "Igual123", confirmarPassword: "Igual123" })).toMatch(/distinta/));
  it("los mensajes nunca incluyen las contraseñas", () => {
    const e = validarCambioPassword({ ...ok, confirmarPassword: "SecretoZ" });
    expect(e).not.toContain("SecretoZ");
    expect(e).not.toContain("Nueva456");
  });
});
