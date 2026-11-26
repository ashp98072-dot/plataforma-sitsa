import { describe, expect, it } from "vitest";
import { clasificarIdentificacion } from "./identificacion-masiva";

describe("clasificación de identidad histórica", () => {
  const base = { piloto_informado: " Jaime  Calderon ", empleado_id: null };
  it("compara el nombre original normalizado sin aproximaciones", () => {
    expect(clasificarIdentificacion(base, "jaime calderon", 8)).toBe("PENDIENTE");
    expect(clasificarIdentificacion(base, "Jayme Calderón", 8)).toBe("AJENO");
    expect(clasificarIdentificacion(base, "", 8)).toBe("AJENO");
  });
  it("preserva vínculos existentes y excluye identidades externas o reportadas", () => {
    expect(clasificarIdentificacion({ ...base, empleado_id: 8 }, "Jaime Calderon", 8)).toBe("IDENTIFICADO");
    expect(clasificarIdentificacion({ ...base, empleado_id: 9 }, "Jaime Calderon", 8)).toBe("CONFLICTO");
    expect(clasificarIdentificacion({ ...base, piloto_externo_id: 1 }, "Jaime Calderon", 8)).toBe("CONFLICTO");
    expect(clasificarIdentificacion({ ...base, piloto_reportado_id: 1 }, "Jaime Calderon", 8)).toBe("CONFLICTO");
  });
});
