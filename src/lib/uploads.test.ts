import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  absPathFromRelative,
  borrarUpload,
  guardarUpload,
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  validarRutaArchivoEmpresa,
  verificarDirectorioPadreReal,
} from "./uploads";

/**
 * ADMIN-LIMPIAR-ARCHIVOS-FISICOS (hardening symlinks) — crear symlinks sin
 * privilegios de administrador está bloqueado (EPERM) en Windows salvo que
 * el "Modo desarrollador" esté activo. Se detecta UNA vez aquí (no en cada
 * test) para saltar (`skipIf`), nunca fallar, los tests que dependen de
 * symlinks reales en un entorno donde el sistema operativo los deniega —
 * el resto de la suite (incluida la ruta NO-symlink de
 * verificarDirectorioPadreReal) sigue corriendo siempre.
 */
function symlinksSoportados(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "sitsa-symlink-probe-"));
  try {
    symlinkSync(join(probe, "destino-inexistente"), join(probe, "enlace"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const SYMLINKS_OK = symlinksSoportados();

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

describe("validarRutaArchivoEmpresa — ADMIN-LIMPIAR-ARCHIVOS-FISICOS (validación estricta de rutas)", () => {
  it("acepta una ruta real de la empresa y devuelve la ruta absoluta correcta", async () => {
    const r = await guardarUpload(7, "firmas", "firma_viatico_autorizar_10", archivoFalso("f.png", 3, "abc"));
    const abs = validarRutaArchivoEmpresa(7, r.relative);
    expect(abs).toBe(absPathFromRelative(r.relative));
  });

  it("normaliza separadores \\ antes de comparar (mismo resultado que con /)", () => {
    const conBarra = "empresas/7/firmas/x.png";
    const conBackslash = "empresas\\7\\firmas\\x.png";
    expect(validarRutaArchivoEmpresa(7, conBackslash)).toBe(validarRutaArchivoEmpresa(7, conBarra));
  });

  it("rechaza una ruta de OTRA empresa aunque el archivo exista físicamente", async () => {
    const r = await guardarUpload(8, "firmas", "firma_viatico_autorizar_99", archivoFalso("f.png", 3, "abc"));
    expect(validarRutaArchivoEmpresa(7, r.relative)).toBeNull();
  });

  it.each([
    "../../etc/passwd",
    "empresas/7/../8/firmas/x.png",
    "empresas/7/firmas/../../8/x.png",
    "empresas/./7/firmas/x.png",
  ])("rechaza intento de path traversal: %s", (ruta) => {
    expect(validarRutaArchivoEmpresa(7, ruta)).toBeNull();
  });

  it.each([
    "/etc/passwd",
    "C:\\Windows\\System32\\config",
    "\\\\servidor\\compartido\\x.png",
    "file:///etc/passwd",
    "http://evil.com/x.png",
  ])("rechaza ruta absoluta o esquema arbitrario: %s", (ruta) => {
    expect(validarRutaArchivoEmpresa(7, ruta)).toBeNull();
  });

  it("rechaza el directorio raíz de la empresa sin nombre de archivo", () => {
    expect(validarRutaArchivoEmpresa(7, "empresas/7/")).toBeNull();
    expect(validarRutaArchivoEmpresa(7, "empresas/7")).toBeNull();
  });

  it.each([null, undefined, "", "   ", 123, {}])("rechaza valores no-string o vacíos: %s", (ruta) => {
    expect(validarRutaArchivoEmpresa(7, ruta)).toBeNull();
  });

  it("rechaza si empresaId no es un entero positivo", () => {
    expect(validarRutaArchivoEmpresa(0, "empresas/0/firmas/x.png")).toBeNull();
    expect(validarRutaArchivoEmpresa(-1, "empresas/-1/firmas/x.png")).toBeNull();
    expect(validarRutaArchivoEmpresa(1.5, "empresas/1.5/firmas/x.png")).toBeNull();
  });

  it("rechaza una ruta con un prefijo de empresa parecido pero distinto (empresas/70/... para empresaId 7)", () => {
    expect(validarRutaArchivoEmpresa(7, "empresas/70/firmas/x.png")).toBeNull();
  });
});

describe("verificarDirectorioPadreReal — ADMIN-LIMPIAR-ARCHIVOS-FISICOS (hardening symlinks intermedios)", () => {
  it("'ok' cuando el directorio padre real está dentro de la raíz real de la empresa (caso normal, sin symlinks)", async () => {
    const r = await guardarUpload(7, "firmas", "x", archivoFalso("f.png", 3, "abc"));
    const abs = absPathFromRelative(r.relative);
    expect(verificarDirectorioPadreReal(7, abs)).toEqual({ estado: "ok" });
  });

  it("'no_existe' cuando el directorio de la empresa nunca se creó (nada que borrar, no es un error)", () => {
    const abs = absPathFromRelative("empresas/999/firmas/x.png");
    expect(verificarDirectorioPadreReal(999, abs)).toEqual({ estado: "no_existe" });
  });

  it("'no_existe' cuando la empresa existe pero el subdirectorio del archivo no", async () => {
    await guardarUpload(7, "firmas", "x", archivoFalso("f.png", 3, "abc")); // crea empresas/7/firmas
    const abs = absPathFromRelative("empresas/7/evidencias/no_creada/x.png");
    expect(verificarDirectorioPadreReal(7, abs)).toEqual({ estado: "no_existe" });
  });

  it.skipIf(!SYMLINKS_OK)("'rechazado' cuando el directorio padre es un symlink que resuelve FUERA de la raíz de la empresa", () => {
    const afuera = mkdtempSync(join(tmpdir(), "sitsa-afuera-"));
    mkdirSync(join(dir, "empresas", "7"), { recursive: true });
    symlinkSync(afuera, join(dir, "empresas", "7", "evidencias"));
    const abs = absPathFromRelative("empresas/7/evidencias/a.jpg");
    const r = verificarDirectorioPadreReal(7, abs);
    expect(r.estado).toBe("rechazado");
    rmSync(afuera, { recursive: true, force: true });
  });

  it.skipIf(!SYMLINKS_OK)("'ok' cuando el symlink intermedio resuelve DENTRO de la propia raíz de la empresa", () => {
    mkdirSync(join(dir, "empresas", "7", "evidencias-real"), { recursive: true });
    symlinkSync(join(dir, "empresas", "7", "evidencias-real"), join(dir, "empresas", "7", "evidencias-alias"));
    const abs = absPathFromRelative("empresas/7/evidencias-alias/a.jpg");
    expect(verificarDirectorioPadreReal(7, abs)).toEqual({ estado: "ok" });
  });

  it("nunca resuelve (realpath) el componente FINAL — un archivo símlink en un directorio real sigue dando 'ok'", async () => {
    // Sin symlinks reales: el padre (empresas/7/firmas) es un directorio
    // normal, así que esto debe dar 'ok' sin necesidad de symlinks — la
    // función solo mira el PADRE, nunca el archivo final.
    await guardarUpload(7, "firmas", "x", archivoFalso("f.png", 3, "abc"));
    const abs = absPathFromRelative("empresas/7/firmas/cualquier-nombre-no-creado.png");
    expect(verificarDirectorioPadreReal(7, abs)).toEqual({ estado: "ok" });
  });
});
