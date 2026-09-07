import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/lib/tms/rutas-import.ts"), "utf8");

describe("contrato de reimportación de rutas", () => {
  it("omite existentes por defecto y solo reemplaza personal cuando fue informado", () => {
    expect(source).toContain("if (rutaExistenteId && !decision?.actualizarExistente)");
    expect(source).toContain("if (codigosPersonal.length)");
    expect(source).toContain("DELETE FROM tms_cliente_ruta_personal WHERE empresa_id = ? AND ruta_id = ?");
  });

  it("una tarifa vacía conserva la actual", () => {
    expect(source).toContain("tarifa_referencia = COALESCE(?, tarifa_referencia)");
  });
});
