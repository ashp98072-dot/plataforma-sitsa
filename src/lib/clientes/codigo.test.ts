import { describe, expect, it } from "vitest";
import { codigoAutomaticoCliente } from "@/lib/clientes/codigo";

describe("código automático de clientes", () => {
  it("genera un código estable y legible desde el ID real", () => {
    expect(codigoAutomaticoCliente(7)).toBe("CLI-000007");
    expect(codigoAutomaticoCliente(1234567)).toBe("CLI-1234567");
  });

  it("rechaza IDs que todavía no existen", () => {
    expect(() => codigoAutomaticoCliente(0)).toThrow("ID de cliente inválido");
  });
});
