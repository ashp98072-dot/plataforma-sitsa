import { describe, expect, it } from "vitest";
import {
  formatearAdvertencia,
  paginarAdvertencias,
  type AdvertenciaImportEmpleado,
} from "./import-advertencias-lista";

/**
 * IMPORT-EMPLEADOS-SEGURA (UI) — lógica pura extraída del panel de
 * advertencias, probada sin renderizar el componente (no hay
 * @testing-library/react en este proyecto, ver
 * documentos-modal.test.ts).
 */

function advertencia(
  overrides: Partial<AdvertenciaImportEmpleado> = {},
): AdvertenciaImportEmpleado {
  return {
    filaExcel: 84,
    codigo: "3",
    nombre: "Maynor Edilser Azurdia Salvajan",
    motivo: "Código sospechoso: 3. Requiere revisión manual.",
    ...overrides,
  };
}

describe("formatearAdvertencia", () => {
  it("con codigo y nombre presentes, arma el título 'Fila N — Nombre' y muestra código y motivo", () => {
    const f = formatearAdvertencia(advertencia());

    expect(f.titulo).toBe(
      "Fila 84 — Maynor Edilser Azurdia Salvajan",
    );
    expect(f.codigo).toBe("3");
    expect(f.motivo).toBe(
      "Código sospechoso: 3. Requiere revisión manual.",
    );
  });

  it("codigo vacío ('Fila sin código identificador.') => codigo queda null, nunca '' ni 'undefined'", () => {
    const f = formatearAdvertencia(
      advertencia({
        filaExcel: 109,
        codigo: "",
        nombre: "Jason Leonel Mayorga Selada",
        motivo: "Fila sin código identificador.",
      }),
    );

    expect(f.titulo).toBe("Fila 109 — Jason Leonel Mayorga Selada");
    expect(f.codigo).toBeNull();
    expect(f.motivo).toBe("Fila sin código identificador.");
  });

  it("nombre vacío ('Fila sin nombre.') => el título no agrega ' — ' colgante", () => {
    const f = formatearAdvertencia(
      advertencia({
        filaExcel: 200,
        codigo: "9999999999999",
        nombre: "",
        motivo: "Fila sin nombre.",
      }),
    );

    expect(f.titulo).toBe("Fila 200");
    expect(f.titulo).not.toContain("—");
    expect(f.codigo).toBe("9999999999999");
  });

  it("campos con solo espacios se tratan como vacíos (trim)", () => {
    const f = formatearAdvertencia(
      advertencia({ codigo: "   ", nombre: "  ", motivo: "  " }),
    );

    expect(f.codigo).toBeNull();
    expect(f.motivo).toBeNull();
    expect(f.titulo).toBe("Fila 84");
  });

  it("nunca produce el texto literal 'undefined' o 'null' en título/código/motivo", () => {
    const f = formatearAdvertencia(
      advertencia({ codigo: "", nombre: "", motivo: "Motivo real" }),
    );

    expect(f.titulo).not.toContain("undefined");
    expect(f.titulo).not.toContain("null");
    expect(String(f.codigo)).not.toBe("undefined");
  });
});

describe("paginarAdvertencias", () => {
  it("con menos filas que el máximo, muestra todas y resto = 0", () => {
    const advertencias = [advertencia({ filaExcel: 1 }), advertencia({ filaExcel: 2 })];
    const { visibles, resto } = paginarAdvertencias(advertencias, 40);

    expect(visibles).toHaveLength(2);
    expect(resto).toBe(0);
  });

  it("con más filas que el máximo, recorta y calcula el resto correctamente", () => {
    const advertencias = Array.from({ length: 45 }, (_, i) =>
      advertencia({ filaExcel: i + 1 }),
    );
    const { visibles, resto } = paginarAdvertencias(advertencias, 40);

    expect(visibles).toHaveLength(40);
    expect(resto).toBe(5);
  });

  it("lista vacía => visibles vacío y resto 0", () => {
    const { visibles, resto } = paginarAdvertencias([], 40);

    expect(visibles).toEqual([]);
    expect(resto).toBe(0);
  });
});
