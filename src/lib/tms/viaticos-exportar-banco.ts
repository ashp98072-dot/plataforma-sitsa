import type { ViaticoPorPagar } from "./viaticos";

/**
 * VIAT-2b — exportador Bi Banking a partir del layout REAL observado en un
 * archivo de carga masiva que la empresa usa actualmente ("24 gastos
 * agosto 26.csv", aportado por el usuario únicamente como referencia
 * estructural — no se copiaron sus personas/cuentas/montos a este código
 * ni a ningún fixture, y el archivo no se subió al repositorio por
 * contener datos bancarios reales).
 *
 * Formato observado (11 filas de muestra, todas con la misma estructura):
 *   - sin encabezados;
 *   - exactamente 5 columnas separadas por coma;
 *   - columna 1: siempre "1" en la muestra — se trata como configuración
 *     del exportador (tipo de operación), NO como un valor bancario
 *     confirmado documentalmente. Default "1".
 *   - columna 2: cuenta/identificador bancario del beneficiario.
 *   - columna 3: nombre del beneficiario.
 *   - columna 4: monto, sin "Q" y sin separador de miles.
 *   - columna 5: concepto.
 * Ejemplo ficticio (formato únicamente, ninguna cuenta/nombre/monto real):
 * 1,1234567890,JUAN PEREZ,250,PAGO DE VIATICOS PLAN-20260824-001
 *
 * IMPORTANTE: el significado bancario exacto de la columna 1 (código de
 * transacción, tipo de cuenta, banco emisor, etc.) NO está confirmado
 * documentalmente — solo se observó que la muestra real siempre usa "1".
 * Se modela como parámetro configurable (`tipoOperacion`, default "1")
 * para no inventar una regla bancaria no confirmada.
 */

export type ProblemaExportBiBanking = {
  id: number;
  planCodigo: string;
  personalNombre: string;
  motivo: string;
};

export type ResultadoValidacionBiBanking =
  | { ok: true }
  | { ok: false; problemas: ProblemaExportBiBanking[] };

/**
 * Reglas mínimas para poder incluir un viático en el archivo bancario
 * (VIAT-2b, punto 4): debe estar AUTORIZADO, tener cuenta bancaria
 * registrada en la ficha del empleado y un monto asignado mayor a cero.
 * No genera nada parcial — si algún seleccionado falla, se reportan TODOS
 * los problemas para que el facturador los corrija antes de reintentar.
 */
export function validarParaBiBanking(
  items: ViaticoPorPagar[],
): ResultadoValidacionBiBanking {
  const problemas: ProblemaExportBiBanking[] = [];
  for (const item of items) {
    if (item.estado !== "AUTORIZADO") {
      problemas.push({
        id: item.id,
        planCodigo: item.planCodigo,
        personalNombre: item.personalNombre,
        motivo: `Estado actual: ${item.estado} (debe estar AUTORIZADO).`,
      });
      continue;
    }
    if (!item.cuentaBancaria?.trim()) {
      problemas.push({
        id: item.id,
        planCodigo: item.planCodigo,
        personalNombre: item.personalNombre,
        motivo: "Sin cuenta bancaria registrada en su ficha (RRHH).",
      });
      continue;
    }
    if (!(item.montoAsignado > 0)) {
      problemas.push({
        id: item.id,
        planCodigo: item.planCodigo,
        personalNombre: item.personalNombre,
        motivo: "Monto inválido (debe ser mayor a Q0.00).",
      });
    }
  }
  return problemas.length ? { ok: false, problemas } : { ok: true };
}

/** Quita comas/comillas/saltos de línea de un campo de texto de una fila de ancho fijo (no hay comillas/escape en este layout). */
function sanearCampoTexto(v: string): string {
  return v.replace(/[",\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Monto sin "Q" y sin separador de miles; sin decimales cuando es un monto entero (igual que la muestra real: "900", no "900.00"). */
function formatearMontoBanco(monto: number): string {
  return Number.isInteger(monto) ? String(monto) : monto.toFixed(2);
}

/** "PAGO DE VIATICOS {CODIGO_VIAJE}" — exactamente el formato pedido, sin agregar ruta/descripción para no inventar reglas bancarias. */
export function conceptoViatico(planCodigo: string): string {
  return `PAGO DE VIATICOS ${planCodigo}`;
}

export const TIPO_OPERACION_DEFAULT = "1";

/**
 * Genera el contenido del archivo Bi Banking: exactamente 5 columnas por
 * fila, sin encabezados, separador coma, salto de línea \r\n. El llamador
 * es responsable de validar con validarParaBiBanking() ANTES de llamar
 * esta función — aquí no se vuelve a validar para mantener esta función
 * pura y fácil de probar.
 */
export function generarArchivoBiBanking(
  items: ViaticoPorPagar[],
  opciones: { tipoOperacion?: string } = {},
): string {
  const tipo = sanearCampoTexto(opciones.tipoOperacion?.trim() || TIPO_OPERACION_DEFAULT);
  const lineas = items.map((item) => {
    const columnas = [
      tipo,
      sanearCampoTexto(item.cuentaBancaria ?? ""),
      sanearCampoTexto(item.personalNombre),
      formatearMontoBanco(item.montoAsignado),
      sanearCampoTexto(conceptoViatico(item.planCodigo)),
    ];
    return columnas.join(",");
  });
  return lineas.join("\r\n") + (lineas.length ? "\r\n" : "");
}

/**
 * Codifica a bytes Windows-1252 (VIAT-2b, punto 5). Node no tiene un
 * códec "windows-1252"/"cp1252" nativo en Buffer; el códec nativo más
 * cercano es "latin1" (ISO-8859-1). Windows-1252 y Latin-1 son IDÉNTICOS
 * en todo el rango 0xA0–0xFF, que cubre exactamente los caracteres que
 * este archivo necesita preservar: Ñ Á É Í Ó Ú ñ á é í ó ú (todos caen en
 * ese rango). Solo difieren en 0x80–0x9F (comillas tipográficas, guión
 * largo, €, etc.), un rango que no se espera en nombres/conceptos de este
 * archivo. Por eso Buffer.from(texto, "latin1") es seguro aquí SIN agregar
 * ninguna dependencia nueva — no es una conversión inventada, es el códec
 * nativo de Node para ese rango de caracteres.
 *
 * Cualquier carácter fuera de 0x00–0xFF (que Latin-1 no puede representar,
 * p. ej. emoji o comillas curvas de Word) se reemplaza por "?" de forma
 * explícita en vez de corromper silenciosamente los bytes siguientes.
 */
export function codificarCp1252(texto: string): Buffer {
  let saneado = texto;
  for (let i = 0; i < saneado.length; i++) {
    if (saneado.charCodeAt(i) > 0xff) {
      saneado = saneado.slice(0, i) + "?" + saneado.slice(i + 1);
    }
  }
  return Buffer.from(saneado, "latin1");
}
