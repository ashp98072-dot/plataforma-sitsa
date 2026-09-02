import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  absPathFromRelative,
  borrarUpload,
  guardarUpload,
  MAX_UPLOAD_BYTES,
  UploadValidationError,
} from "./uploads";

/**
 * RRHH-EXPEDIENTES-UPLOAD-STABILITY (secciones 4/5/10 del ticket) —
 * guardarUpload()/borrarUpload() contra un directorio temporal REAL (vía
 * UPLOAD_DIR, ya soportado por getUploadsRoot()) en vez de mockear `fs`:
 * verifica el comportamiento real de la escritura async (MEJORA A —
 * fs/promises.writeFile en vez de writeFileSync) y las validaciones de
 * tamaño/formato SIN necesidad de reimplementar la lógica de fs a mano.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sitsa-uploads-test-"));
  process.env.UPLOAD_DIR = dir;
});

afterEach(() => {
  delete process.env.UPLOAD_DIR;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `sizeBytes` es el tamaño DECLARADO (lo único que guardarUpload valida
 * antes de tocar el archivo) — puede no coincidir con el contenido real
 * cuando el test solo necesita disparar el rechazo por tamaño sin
 * materializar bytes reales. Para verificar el contenido escrito en
 * disco, pasar `contenido` con longitud igual a `sizeBytes`.
 */
function archivoFalso(name: string, sizeBytes: number, contenido = "x"): {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  const bytes = new TextEncoder().encode(contenido);
  return {
    name,
    size: sizeBytes,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  };
}

describe("guardarUpload — escritura real (async), validaciones ANTES de escribir", () => {
  it("guarda el archivo de verdad en disco (contenido correcto) y devuelve relative/original/size", async () => {
    const r = await guardarUpload(7, "documentos", "emp42", archivoFalso("dpi.pdf", 5, "abcde"));
    expect(r.original).toBe("dpi.pdf");
    expect(r.size).toBe(5);
    expect(r.relative.startsWith("empresas/7/documentos/")).toBe(true);
    const abs = absPathFromRelative(r.relative);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs, "utf8")).toBe("abcde");
  });

  it("Caso C / AJUSTE PRE-MERGE PR #176: archivo > MAX_UPLOAD_BYTES → UploadValidationError(413), rechaza ANTES de escribir nada en disco", async () => {
    await expect(
      guardarUpload(7, "documentos", "emp42", archivoFalso("grande.pdf", MAX_UPLOAD_BYTES + 1, "x")),
    ).rejects.toThrow(/supera el máximo/);
    try {
      await guardarUpload(7, "documentos", "emp42", archivoFalso("grande.pdf", MAX_UPLOAD_BYTES + 1, "x"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UploadValidationError);
      expect((err as UploadValidationError).status).toBe(413);
    }
    // Nada se escribió: el directorio de la empresa ni siquiera se creó.
    expect(existsSync(join(dir, "empresas", "7"))).toBe(false);
  });

  it("Caso E / AJUSTE PRE-MERGE PR #176: extensión no permitida → UploadValidationError(400), rechaza ANTES de escribir nada en disco", async () => {
    try {
      await guardarUpload(7, "documentos", "emp42", archivoFalso("contrato.docx", 10, "x"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UploadValidationError);
      expect((err as UploadValidationError).status).toBe(400);
      expect((err as Error).message).toMatch(/Formato no permitido/);
    }
    expect(existsSync(join(dir, "empresas", "7"))).toBe(false);
  });

  it("archivo vacío (size 0) → UploadValidationError(400), rechaza sin escribir", async () => {
    try {
      await guardarUpload(7, "documentos", "emp42", archivoFalso("vacio.pdf", 0));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UploadValidationError);
      expect((err as UploadValidationError).status).toBe(400);
      expect((err as Error).message).toMatch(/vacío/);
    }
    expect(existsSync(join(dir, "empresas", "7"))).toBe(false);
  });

  it("dos subidas seguidas nunca colisionan de nombre (timestamp + random)", async () => {
    const a = await guardarUpload(7, "documentos", "emp42", archivoFalso("dpi.pdf", 3, "aaa"));
    const b = await guardarUpload(7, "documentos", "emp42", archivoFalso("dpi.pdf", 3, "bbb"));
    expect(a.relative).not.toBe(b.relative);
    const files = readdirSync(join(dir, "empresas", "7", "documentos"));
    expect(files).toHaveLength(2);
  });
});

describe("borrarUpload — cleanup best-effort (sección 9 del ticket)", () => {
  it("elimina un archivo existente", async () => {
    const r = await guardarUpload(7, "documentos", "emp42", archivoFalso("dpi.pdf", 3, "abc"));
    expect(existsSync(absPathFromRelative(r.relative))).toBe(true);
    borrarUpload(r.relative);
    expect(existsSync(absPathFromRelative(r.relative))).toBe(false);
  });

  it("no lanza error si el archivo ya no existe (idempotente, best-effort)", async () => {
    expect(() => borrarUpload("empresas/7/documentos/no_existe.pdf")).not.toThrow();
  });
});
