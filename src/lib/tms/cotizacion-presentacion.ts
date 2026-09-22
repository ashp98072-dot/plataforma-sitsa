import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { DOCUMENTOS_EMISOR, LIMITE_TEXTO_MENSAJE_COMERCIAL, MARCAS_DOCUMENTO, type DocumentoEmisor } from "./cotizacion-documento";

/**
 * COTIZACIONES — PRESENTACIÓN COMERCIAL: mensaje introductorio y cierre
 * PREDETERMINADOS por marca (plantilla al crear, editable en Operaciones →
 * Ajustes de cotizaciones). NO es el texto YA GUARDADO en una cotización — eso vive en
 * `tms_cotizaciones.mensaje_comercial`/`cierre_comercial` (ver
 * cotizacion-documento.ts). Ajustes = plantilla futura; cotización = lo que
 * de verdad se envió.
 *
 * Se guarda reutilizando la tabla genérica `configuracion` (empresa_id,
 * parametro, valor) — ya existe en producción (migrate-2026-08-rrhh-core.sql,
 * hoy usada por RRHH vía src/lib/rrhh/config.ts) y es tenant-safe por
 * construcción (PK compuesta empresa_id+parametro). No se creó una tabla
 * nueva solo para 4 valores de texto por empresa. Los `parametro` usan un
 * prefijo `cotizaciones_` para no chocar con las claves de RRHH — son
 * filas propias, sin relación con esos otros parámetros.
 */

const PARAMETRO: Record<DocumentoEmisor, { mensaje: string; cierre: string }> = {
  KUIQTRANS: { mensaje: "cotizaciones_mensaje_kuiqtrans", cierre: "cotizaciones_cierre_kuiqtrans" },
  MONACO: { mensaje: "cotizaciones_mensaje_monaco", cierre: "cotizaciones_cierre_monaco" },
};

export type PresentacionMarca = { mensaje: string; cierre: string };
export type PresentacionComercial = Record<DocumentoEmisor, PresentacionMarca>;

/**
 * Defaults por marca para esta empresa. Una fila ausente (o toda la tabla
 * ausente, si la instalación no tiene `configuracion` todavía) cae al texto
 * histórico de `MARCAS_DOCUMENTO` — el MISMO fallback determinista que usa
 * el PDF para una cotización sin texto propio guardado, así el formulario y el documento
 * nunca muestran un mensaje distinto para "sin configurar".
 */
export async function obtenerPresentacionComercial(empresaId: number): Promise<PresentacionComercial> {
  const resultado = Object.fromEntries(
    DOCUMENTOS_EMISOR.map((marca) => [marca, { mensaje: MARCAS_DOCUMENTO[marca].saludo, cierre: MARCAS_DOCUMENTO[marca].cierre }]),
  ) as PresentacionComercial;
  try {
    const claves = DOCUMENTOS_EMISOR.flatMap((m) => [PARAMETRO[m].mensaje, PARAMETRO[m].cierre]);
    const rows = await query<RowDataPacket[]>(
      `SELECT parametro, valor FROM configuracion WHERE empresa_id = ? AND parametro IN (${claves.map(() => "?").join(",")})`,
      [empresaId, ...claves],
    );
    const porClave = new Map(rows.map((r) => [String(r.parametro), String(r.valor)]));
    for (const marca of DOCUMENTOS_EMISOR) {
      const mensaje = porClave.get(PARAMETRO[marca].mensaje);
      const cierre = porClave.get(PARAMETRO[marca].cierre);
      if (mensaje) resultado[marca].mensaje = mensaje;
      if (cierre) resultado[marca].cierre = cierre;
    }
  } catch {
    /* Tabla configuracion aún no migrada en esta instalación: se sirven los defaults fijos. */
  }
  return resultado;
}

/** Opcionales: un campo vacío/omitido no se guarda (esa marca vuelve a depender del fallback fijo). */
export type CambiosPresentacion = Partial<Record<DocumentoEmisor, Partial<PresentacionMarca>>>;

function validarLargo(valor: string | undefined, etiqueta: string) {
  if (valor != null && valor.length > LIMITE_TEXTO_MENSAJE_COMERCIAL) {
    throw new Error(`${etiqueta} no puede exceder ${LIMITE_TEXTO_MENSAJE_COMERCIAL} caracteres.`);
  }
}

/**
 * Guarda los defaults editados en Ajustes. Nunca toca cotizaciones ya
 * creadas (esas ya tienen su propio texto guardado). Un valor vacío BORRA el
 * override (vuelve a depender del fallback fijo de la marca) en vez de
 * guardar una cadena vacía.
 */
export async function guardarPresentacionComercial(empresaId: number, cambios: CambiosPresentacion): Promise<void> {
  for (const marca of DOCUMENTOS_EMISOR) {
    const c = cambios[marca];
    if (!c) continue;
    validarLargo(c.mensaje, `El mensaje predeterminado de ${MARCAS_DOCUMENTO[marca].nombre}`);
    validarLargo(c.cierre, `El cierre predeterminado de ${MARCAS_DOCUMENTO[marca].nombre}`);
  }
  for (const marca of DOCUMENTOS_EMISOR) {
    const c = cambios[marca];
    if (!c) continue;
    if (c.mensaje !== undefined) await guardarValor(empresaId, PARAMETRO[marca].mensaje, c.mensaje.trim());
    if (c.cierre !== undefined) await guardarValor(empresaId, PARAMETRO[marca].cierre, c.cierre.trim());
  }
}

async function guardarValor(empresaId: number, parametro: string, valor: string): Promise<void> {
  // Vacío = "sin override": se guarda como cadena vacía (config sigue teniendo la fila, simplemente
  // obtenerPresentacionComercial la trata como ausente vía `if (mensaje)`), nunca se hace DELETE —
  // configuracion es un almacén genérico compartido con RRHH, esta capa nunca borra filas.
  await execute(
    `INSERT INTO configuracion (empresa_id, parametro, valor) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
    [empresaId, parametro, valor],
  );
}
