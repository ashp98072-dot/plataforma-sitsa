import { unlink } from "fs/promises";
import { validarRutaArchivoEmpresa, verificarDirectorioPadreReal } from "@/lib/uploads";

export type ResultadoArchivosFisicos = {
  detectados: number;
  eliminados: number;
  noEncontrados: number;
  conError: number;
  advertencias: string[];
};

/**
 * ADMIN-LIMPIAR-ARCHIVOS-FISICOS — borra, DESPUÉS del commit de la
 * transacción de BD, los archivos físicos recolectados durante una
 * limpieza (ver limpiar-operaciones.ts: recolectarRutasArchivo()).
 *
 * Nunca debe llamarse antes de comprometer la transacción: un rollback de
 * BD con un archivo ya borrado dejaría, ante un reintento, un registro
 * apuntando a un archivo inexistente. El filesystem no participa en la
 * transacción MySQL — este paso es deliberadamente el ÚLTIMO, fuera de
 * cualquier `try { beginTransaction(); ... }`.
 *
 * Cada ruta se vuelve a validar aquí (nunca se confía en que ya se validó
 * antes; la validación es barata y el costo de una segunda verificación es
 * insignificante frente al riesgo de borrar fuera del árbol de la
 * empresa), en dos capas:
 *
 *  1. `validarRutaArchivoEmpresa()` — léxica (path traversal, rutas
 *     absolutas, prefijo `empresas/<empresaId>/`).
 *  2. `verificarDirectorioPadreReal()` — real (`realpathSync`): rechaza un
 *     directorio intermedio que resulte ser un symlink hacia fuera del
 *     storage de esta empresa, aunque la ruta lexicalmente calce.
 *
 * NUNCA se usa `existsSync()` + `unlink()` como dos pasos separados (eso
 * deja una ventana de carrera entre comprobar y borrar) — se intenta
 * `unlink()` directamente y se interpreta el resultado: `ENOENT` (el
 * archivo ya no existe, pudo borrarse antes o nunca haberse escrito — p.
 * ej. una firma solo con contraseña, sin imagen) es NO CRÍTICO; cualquier
 * otro error (permiso denegado, `EISDIR` si el registro apuntara por error
 * a un directorio, disco de solo lectura, etc.) es un error real. Ninguno
 * de los dos casos revierte la BD (ya está comprometida) ni lanza — se
 * reportan como conteo/advertencia para que el administrador lo resuelva
 * manualmente.
 */
export async function borrarArchivosFisicos(
  empresaId: number,
  rutas: Iterable<string>,
): Promise<ResultadoArchivosFisicos> {
  const resultado: ResultadoArchivosFisicos = {
    detectados: 0,
    eliminados: 0,
    noEncontrados: 0,
    conError: 0,
    advertencias: [],
  };
  for (const ruta of rutas) {
    resultado.detectados += 1;
    const abs = validarRutaArchivoEmpresa(empresaId, ruta);
    if (!abs) {
      resultado.conError += 1;
      resultado.advertencias.push(
        `Ruta rechazada por validación de seguridad (no pertenece a esta empresa o es inválida): ${ruta}`,
      );
      continue;
    }

    const verificacion = verificarDirectorioPadreReal(empresaId, abs);
    if (verificacion.estado === "no_existe") {
      resultado.noEncontrados += 1;
      continue;
    }
    if (verificacion.estado === "rechazado") {
      resultado.conError += 1;
      resultado.advertencias.push(`${verificacion.motivo} Ruta: ${ruta}`);
      continue;
    }

    try {
      await unlink(abs);
      resultado.eliminados += 1;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        resultado.noEncontrados += 1;
        continue;
      }
      resultado.conError += 1;
      const mensaje = err instanceof Error ? err.message : String(err);
      resultado.advertencias.push(`No se pudo eliminar ${ruta}: ${mensaje}`);
    }
  }
  return resultado;
}
