import { describe, expect, it } from "vitest";
import { validarArchivo } from "./documentos-modal";

/**
 * RRHH-EXPEDIENTES-UPLOAD-STABILITY (sección 3 del ticket) — gate del
 * frontend: NUNCA debe hacerse el fetch si el archivo no pasa esta
 * validación. Función pura extraída y probada sin renderizar el modal
 * completo — mismo criterio ya usado en plan-form.test.ts (no hay
 * @testing-library/react en este proyecto).
 */
function archivo(nombre: string, size: number): File {
  return new File([new Uint8Array(Math.min(size, 1024))], nombre, {
    type: "application/octet-stream",
  }) as unknown as File & { size: number };
}

// File.size real viene del contenido del Blob — para simular tamaños
// grandes sin materializar bytes reales, se sobre-escribe la propiedad
// `size` del File construido (getter no configurable por defecto en
// algunos runtimes, así que se usa defineProperty).
function archivoConTamano(nombre: string, size: number): File {
  const f = archivo(nombre, 0);
  Object.defineProperty(f, "size", { value: size, configurable: true });
  return f;
}

describe("validarArchivo — gate obligatorio antes del fetch", () => {
  it("Caso A: PDF pequeño, formato permitido → null (sin problema, se envía)", () => {
    expect(validarArchivo(archivoConTamano("dpi.pdf", 1024))).toBeNull();
  });

  it.each([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".pdf"])(
    "extensión permitida %s → null",
    (ext) => {
      expect(validarArchivo(archivoConTamano(`doc${ext}`, 1024))).toBeNull();
    },
  );

  it("Caso E: formato no permitido (.docx) → mensaje de rechazo, NUNCA null", () => {
    const r = validarArchivo(archivoConTamano("contrato.docx", 1024));
    expect(r).toMatch(/Formato no permitido/);
  });

  it("Caso E: sin extensión → rechazado", () => {
    const r = validarArchivo(archivoConTamano("archivo_sin_extension", 1024));
    expect(r).toMatch(/Formato no permitido/);
  });

  it("Caso C/D: archivo > 50 MB → mensaje de rechazo (nunca null) — este es el gate que evita el fetch", () => {
    const r = validarArchivo(archivoConTamano("expediente.pdf", 50 * 1024 * 1024 + 1));
    expect(r).toMatch(/supera el máximo/);
    expect(r).toMatch(/50 MB/);
  });

  it("archivo exactamente en el límite (50 MB) → permitido (límite inclusive)", () => {
    expect(validarArchivo(archivoConTamano("expediente.pdf", 50 * 1024 * 1024))).toBeNull();
  });

  it("archivo vacío (0 bytes) → rechazado", () => {
    const r = validarArchivo(archivoConTamano("vacio.pdf", 0));
    expect(r).toMatch(/vacío/);
  });
});
