import { describe, expect, it } from "vitest";
import { CAMPOS_OBLIGATORIOS_ALTA, faltantesAlta } from "./empleado-validacion";
import { empleadoBodySchema, validarAltaMonaco } from "./empleado-api-schema";

const alta = () => ({
  ...Object.fromEntries(CAMPOS_OBLIGATORIOS_ALTA.map(({ key }) => [key, "Prueba"])),
  codigo: "0000000000001", dpi: "0000000000001", fechaAlta: "2026-08-27",
  fechaNacimiento: "1990-01-01", estado: "Activo", tipoContrato: "Fijo",
  sueldoBase: 4000, bonoIncentivo: 250, bonoHerramientas: 0,
});

describe("alta con datos pendientes de entrega", () => {
  it.each([undefined, null, ""])("acepta NIT, IGSS, IRTRA y correo pendientes (%s)", (valor) => {
    const body = { ...alta(), nit: valor, igss: valor, irtra: valor, email: valor };
    expect(faltantesAlta(body).labels).toEqual([]);
    const parsed = empleadoBodySchema.parse(body);
    expect(validarAltaMonaco(parsed)).toBeNull();
  });
  it("mantiene obligatorios DPI y datos laborales", () => {
    const body = { ...alta(), dpi: "", puesto: "" };
    expect(faltantesAlta(body).labels).toEqual(expect.arrayContaining(["DPI", "Puesto"]));
    expect(validarAltaMonaco(empleadoBodySchema.parse(body))).not.toBeNull();
  });
  it("permite completar después y rechaza correo inválido", () => {
    expect(empleadoBodySchema.safeParse({ ...alta(), nit: "123-K", igss: "123", irtra: "456", email: "prueba@example.com" }).success).toBe(true);
    expect(empleadoBodySchema.safeParse({ ...alta(), email: "incorrecto" }).success).toBe(false);
  });
});
