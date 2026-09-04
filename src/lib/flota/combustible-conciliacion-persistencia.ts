import type { ResultSetHeader } from "mysql2";
import { getPool } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";

import type {
  DiferenciaCampo,
  ResultadoConciliacion,
} from "./combustible-conciliacion";

export type EstadoFilaConciliacionPersistida =
  | "COINCIDE"
  | "DIFERENCIA"
  | "SOLO_GASOLINERA"
  | "SOLO_SISTEMA"
  | "AMBIGUO"
  | "DESCARTADA";

export type ArchivoConciliacionGuardado = {
  nombreOriginal: string;
  rutaRelativa: string;
  mime: string | null;
  tamano: number;
};

export type FilaDescartadaConciliacion = {
  fila: number;
  motivo: string;
};

export type GuardarConciliacionInput = {
  empresaId: number;
  archivo: ArchivoConciliacionGuardado;
  hoja: string;
  subidoPor: string;
  resultados: ResultadoConciliacion[];
  descartadas: FilaDescartadaConciliacion[];
};

export type GuardarConciliacionResultado = {
  conciliacionId: number;
  filasGuardadas: number;
};

function jsonDiferencias(
  diferencias: DiferenciaCampo[],
): string | null {
  if (!diferencias.length) {
    return null;
  }

  return JSON.stringify(diferencias);
}

/**
 * FLOTA-COMBUSTIBLE-3
 *
 * Persiste una fotografía histórica completa de la conciliación:
 *
 * - cabecera del archivo importado;
 * - filas conciliadas;
 * - filas descartadas;
 * - valores del sistema;
 * - valores reportados por la gasolinera;
 * - diferencias detectadas.
 *
 * IMPORTANTE:
 * Esta función NO modifica flota_combustible_cargas.
 * Tampoco aprueba/rechaza cargas.
 *
 * Cabecera + filas se guardan dentro de UNA sola transacción.
 */
export async function guardarConciliacionCombustible(
  input: GuardarConciliacionInput,
): Promise<GuardarConciliacionResultado> {
  if (
    !Number.isInteger(input.empresaId) ||
    input.empresaId <= 0
  ) {
    throw new Error("empresaId inválido.");
  }

  if (!input.archivo.nombreOriginal.trim()) {
    throw new Error("Nombre de archivo inválido.");
  }

  if (!input.archivo.rutaRelativa.trim()) {
    throw new Error("Ruta de archivo inválida.");
  }

  if (!input.hoja.trim()) {
    throw new Error("Hoja de Excel inválida.");
  }

  if (!input.subidoPor.trim()) {
    throw new Error("Usuario inválido.");
  }

  const conn = await getPool().getConnection();
  const ahora = ahoraLocal();

  try {
    await conn.beginTransaction();

    const [cabeceraResult] =
      await conn.execute<ResultSetHeader>(
        `INSERT INTO flota_combustible_conciliaciones
          (
            empresa_id,
            nombre_original,
            ruta_relativa,
            mime,
            tamano,
            hoja,
            subido_por,
            creado_at
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.empresaId,
          input.archivo.nombreOriginal,
          input.archivo.rutaRelativa,
          input.archivo.mime,
          input.archivo.tamano,
          input.hoja.trim(),
          input.subidoPor.trim(),
          ahora,
        ],
      );

    const conciliacionId = Number(
      cabeceraResult.insertId,
    );

    if (!conciliacionId) {
      throw new Error(
        "No se pudo crear la conciliación.",
      );
    }

    let filasGuardadas = 0;

    for (const resultado of input.resultados) {
      const sistema = resultado.sistema;
      const gasolinera = resultado.gasolinera;

      await conn.execute(
        `INSERT INTO flota_combustible_conciliacion_filas
          (
            conciliacion_id,
            empresa_id,
            fila_excel,
            estado,
            motivo,
            carga_combustible_id,
            estado_sistema,

            vale_gasolinera,
            fecha_gasolinera,
            placa_gasolinera,
            piloto_gasolinera,
            producto_gasolinera,
            galones_gasolinera,
            precio_gasolinera,
            monto_gasolinera,

            vale_sistema,
            fecha_sistema,
            placa_sistema,
            piloto_sistema,
            producto_sistema,
            galones_sistema,
            precio_sistema,
            monto_sistema,

            diferencias,
            creado_at
          )
         VALUES (
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?
         )`,
        [
          conciliacionId,
          input.empresaId,
          gasolinera?.fila ?? null,
          resultado.estado,
          null,
          sistema?.id ?? null,
          // Metadata histórica pura — nunca influye en resultado.estado
          // (ver JSDoc de CargaSistemaConciliacion.estadoSistema).
          sistema?.estadoSistema ?? null,

          gasolinera?.numeroVale ?? null,
          gasolinera?.fechaConsumo ?? null,
          gasolinera?.placa ?? null,
          gasolinera?.pilotoNombre ?? null,
          gasolinera?.producto ?? null,
          gasolinera?.galones ?? null,
          gasolinera?.precioGalon ?? null,
          gasolinera?.monto ?? null,

          sistema?.numeroVale ?? null,
          sistema?.fechaConsumo ?? null,
          sistema?.placa ?? null,
          sistema?.pilotoNombre ?? null,
          sistema?.producto ?? null,
          sistema?.galones ?? null,
          sistema?.precioGalon ?? null,
          sistema?.monto ?? null,

          jsonDiferencias(resultado.diferencias),
          ahora,
        ],
      );

      filasGuardadas += 1;
    }

    for (const descartada of input.descartadas) {
      await conn.execute(
        `INSERT INTO flota_combustible_conciliacion_filas
          (
            conciliacion_id,
            empresa_id,
            fila_excel,
            estado,
            motivo,
            carga_combustible_id,
            estado_sistema,

            vale_gasolinera,
            fecha_gasolinera,
            placa_gasolinera,
            piloto_gasolinera,
            producto_gasolinera,
            galones_gasolinera,
            precio_gasolinera,
            monto_gasolinera,

            vale_sistema,
            fecha_sistema,
            placa_sistema,
            piloto_sistema,
            producto_sistema,
            galones_sistema,
            precio_sistema,
            monto_sistema,

            diferencias,
            creado_at
          )
         VALUES (
           ?, ?, ?, 'DESCARTADA', ?, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           NULL, ?
         )`,
        [
          conciliacionId,
          input.empresaId,
          descartada.fila,
          descartada.motivo,
          ahora,
        ],
      );

      filasGuardadas += 1;
    }

    await conn.commit();

    return {
      conciliacionId,
      filasGuardadas,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}