import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absPathFromRelative } from "@/lib/uploads";
import { borrarArchivosFisicos } from "./limpiar-archivos";

/**
 * ADMIN-LIMPIAR-ARCHIVOS-FISICOS — igual que uploads.test.ts, contra un
 * directorio temporal REAL (vía UPLOAD_DIR) en vez de mockear `fs`: este
 * módulo es un wrapper directo sobre el filesystem, así que su
 * comportamiento correcto ES justamente el de tocar disco de verdad — pero
 * SIEMPRE dentro de un tmpdir aislado, nunca dentro del repositorio.
 *
 * Symlinks: crearlos sin privilegios de administrador está bloqueado
 * (EPERM) en Windows salvo "Modo desarrollador" activo — se detecta UNA
 * vez (no falla el resto de la suite) y los tests que dependen de
 * symlinks reales se saltan (`skipIf`) si el entorno no los permite.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sitsa-limpiar-archivos-test-"));
  process.env.UPLOAD_DIR = dir;
});

afterEach(() => {
  delete process.env.UPLOAD_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function crearArchivo(relative: string, contenido = "x"): string {
  const abs = absPathFromRelative(relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contenido);
  return abs;
}

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

describe("borrarArchivosFisicos — sin TOCTOU (unlink directo, nunca existsSync + unlink por separado)", () => {
  it("elimina un archivo existente y lo cuenta como eliminado", async () => {
    crearArchivo("empresas/7/firmas/x.png");
    const r = await borrarArchivosFisicos(7, ["empresas/7/firmas/x.png"]);
    expect(r).toEqual({ detectados: 1, eliminados: 1, noEncontrados: 0, conError: 0, advertencias: [] });
    expect(existsSync(absPathFromRelative("empresas/7/firmas/x.png"))).toBe(false);
  });

  it("1) unlink() que lanza ENOENT (archivo inexistente, directorio SÍ existe) => noEncontrados, NUNCA conError", async () => {
    // El directorio padre existe (creado por el archivo hermano), pero el
    // archivo objetivo nunca se escribió: unlink() debe lanzar ENOENT
    // real — no hay existsSync() previo que lo intercepte antes.
    crearArchivo("empresas/7/firmas/existe.png");
    const r = await borrarArchivosFisicos(7, ["empresas/7/firmas/no_existe.png"]);
    expect(r).toEqual({ detectados: 1, eliminados: 0, noEncontrados: 1, conError: 0, advertencias: [] });
  });

  it("un archivo inexistente no rompe el resto del lote (mezclado con uno real)", async () => {
    crearArchivo("empresas/7/firmas/existe.png");
    const r = await borrarArchivosFisicos(7, [
      "empresas/7/firmas/no_existe.png",
      "empresas/7/firmas/existe.png",
    ]);
    expect(r.detectados).toBe(2);
    expect(r.noEncontrados).toBe(1);
    expect(r.eliminados).toBe(1);
    expect(r.conError).toBe(0);
    expect(r.advertencias).toEqual([]);
  });

  it("2) ya no depende de existsSync: un directorio de empresa que nunca existió también da noEncontrados, no conError", async () => {
    const r = await borrarArchivosFisicos(999, ["empresas/999/firmas/x.png"]);
    expect(r).toEqual({ detectados: 1, eliminados: 0, noEncontrados: 1, conError: 0, advertencias: [] });
  });

  it("rechaza y reporta como advertencia una ruta de OTRA empresa — nunca la toca, y sigue procesando el resto del lote", async () => {
    crearArchivo("empresas/8/firmas/ajena.png");
    crearArchivo("empresas/7/firmas/propia.png");
    const r = await borrarArchivosFisicos(7, [
      "empresas/8/firmas/ajena.png",
      "empresas/7/firmas/propia.png",
    ]);
    expect(r.detectados).toBe(2);
    expect(r.conError).toBe(1);
    expect(r.eliminados).toBe(1);
    expect(r.advertencias[0]).toMatch(/no pertenece a esta empresa|inválida/);
    expect(existsSync(absPathFromRelative("empresas/8/firmas/ajena.png"))).toBe(true);
    expect(existsSync(absPathFromRelative("empresas/7/firmas/propia.png"))).toBe(false);
  });

  it("8) el prefijo de empresa 12 vs 123 sigue protegido de punta a punta (validación léxica + real)", async () => {
    crearArchivo("empresas/123/firmas/ajena.png");
    const r = await borrarArchivosFisicos(12, ["empresas/123/firmas/ajena.png"]);
    expect(r.conError).toBe(1);
    expect(r.eliminados).toBe(0);
    expect(existsSync(absPathFromRelative("empresas/123/firmas/ajena.png"))).toBe(true);
  });

  it("rechaza y reporta como advertencia un intento de path traversal, sin lanzar", async () => {
    const r = await borrarArchivosFisicos(7, ["empresas/7/../8/firmas/x.png"]);
    expect(r.conError).toBe(1);
    expect(r.eliminados).toBe(0);
  });

  it("rechaza y reporta como advertencia una ruta absoluta arbitraria, sin lanzar", async () => {
    const r = await borrarArchivosFisicos(7, ["/etc/passwd"]);
    expect(r.conError).toBe(1);
    expect(r.eliminados).toBe(0);
  });

  it("procesa un Set deduplicado sin volver a contar la misma ruta dos veces", async () => {
    crearArchivo("empresas/7/firmas/x.png");
    const r = await borrarArchivosFisicos(7, new Set(["empresas/7/firmas/x.png"]));
    expect(r.detectados).toBe(1);
    expect(r.eliminados).toBe(1);
  });

  it("6) directorio normal dentro de la empresa => el archivo se elimina correctamente (regresión tras el hardening de symlinks)", async () => {
    crearArchivo("empresas/7/flota/a.jpg");
    const r = await borrarArchivosFisicos(7, ["empresas/7/flota/a.jpg"]);
    expect(r).toEqual({ detectados: 1, eliminados: 1, noEncontrados: 0, conError: 0, advertencias: [] });
  });

  it("7) un directorio como target final NUNCA se elimina — se reporta como conError, no como éxito", async () => {
    // unlink() sobre un directorio falla de forma real y determinista en
    // cualquier plataforma (EISDIR/EPERM) — el directorio permanece intacto.
    const abs = absPathFromRelative("empresas/7/firmas/no_es_archivo");
    mkdirSync(abs, { recursive: true });
    const r = await borrarArchivosFisicos(7, ["empresas/7/firmas/no_es_archivo"]);
    expect(r.detectados).toBe(1);
    expect(r.eliminados).toBe(0);
    expect(r.conError).toBe(1);
    expect(r.advertencias[0]).toContain("empresas/7/firmas/no_es_archivo");
    expect(existsSync(abs)).toBe(true);
  });

  it("no altera archivos de otra empresa ni de otro tipo mientras procesa un lote mixto (válidos + inválidos)", async () => {
    crearArchivo("empresas/7/flota/a.jpg");
    crearArchivo("empresas/7/firmas/b.png");
    crearArchivo("empresas/9/firmas/no_tocar.png");
    const r = await borrarArchivosFisicos(7, [
      "empresas/7/flota/a.jpg",
      "empresas/7/firmas/b.png",
      "empresas/9/firmas/no_tocar.png",
      "../../etc/passwd",
    ]);
    expect(r.detectados).toBe(4);
    expect(r.eliminados).toBe(2);
    expect(r.conError).toBe(2);
    expect(existsSync(absPathFromRelative("empresas/9/firmas/no_tocar.png"))).toBe(true);
  });
});

describe("borrarArchivosFisicos — hardening symlinks (realpath del directorio PADRE, nunca del componente final)", () => {
  it.skipIf(!SYMLINKS_OK)(
    "3) directorio intermedio symlink hacia FUERA de la empresa => rechazado, unlink jamás se intenta",
    async () => {
      const afuera = mkdtempSync(join(tmpdir(), "sitsa-afuera-"));
      writeFileSync(join(afuera, "a.jpg"), "secreto-de-otro-lugar");
      mkdirSync(join(dir, "empresas", "7"), { recursive: true });
      // "evidencias" ya NO es un directorio real: es un symlink hacia `afuera`.
      symlinkSync(afuera, join(dir, "empresas", "7", "evidencias"));

      const r = await borrarArchivosFisicos(7, ["empresas/7/evidencias/a.jpg"]);
      expect(r.eliminados).toBe(0);
      expect(r.conError).toBe(1);
      expect(r.advertencias[0]).toMatch(/symlink|fuera del storage/);

      // 4) el archivo real detrás del symlink queda completamente intacto.
      expect(existsSync(join(afuera, "a.jpg"))).toBe(true);
      rmSync(afuera, { recursive: true, force: true });
    },
  );

  it.skipIf(!SYMLINKS_OK)(
    "un symlink intermedio que resuelve DENTRO de la propia empresa se permite con normalidad",
    async () => {
      mkdirSync(join(dir, "empresas", "7", "evidencias-real"), { recursive: true });
      writeFileSync(join(dir, "empresas", "7", "evidencias-real", "a.jpg"), "contenido");
      symlinkSync(join(dir, "empresas", "7", "evidencias-real"), join(dir, "empresas", "7", "evidencias-alias"));

      const r = await borrarArchivosFisicos(7, ["empresas/7/evidencias-alias/a.jpg"]);
      expect(r).toEqual({ detectados: 1, eliminados: 1, noEncontrados: 0, conError: 0, advertencias: [] });
      // Se borró a través del alias — el archivo real ya no está.
      expect(existsSync(join(dir, "empresas", "7", "evidencias-real", "a.jpg"))).toBe(false);
    },
  );

  it.skipIf(!SYMLINKS_OK)(
    "5) symlink FINAL de archivo dentro de la empresa => unlink elimina SOLO el enlace, nunca el destino real",
    async () => {
      const afuera = mkdtempSync(join(tmpdir(), "sitsa-destino-real-"));
      const destinoReal = join(afuera, "original.png");
      writeFileSync(destinoReal, "contenido-original");
      mkdirSync(join(dir, "empresas", "7", "firmas"), { recursive: true });
      const enlace = join(dir, "empresas", "7", "firmas", "enlace.png");
      symlinkSync(destinoReal, enlace);

      const r = await borrarArchivosFisicos(7, ["empresas/7/firmas/enlace.png"]);
      expect(r).toEqual({ detectados: 1, eliminados: 1, noEncontrados: 0, conError: 0, advertencias: [] });
      expect(existsSync(enlace)).toBe(false); // el enlace ya no existe
      expect(existsSync(destinoReal)).toBe(true); // el archivo real, SÍ sigue existiendo
      rmSync(afuera, { recursive: true, force: true });
    },
  );
});
