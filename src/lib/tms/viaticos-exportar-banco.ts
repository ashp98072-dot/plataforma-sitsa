import type { ViaticoPorPagar } from "./viaticos";

/**
 * VIAT-2 (punto 4) — exportador bancario GENÉRICO y configurable, NO el
 * layout oficial de Bi Banking/GuateACH.
 *
 * Se revisó el repositorio (grep de "bi banking", "guateach", "ach",
 * "archivo bancario", "layout bancario") y NO existe ningún exportador
 * bancario/ACH/de planilla previo — solo un exportador Excel genérico
 * (tablaAExcel en src/lib/rrhh/export-files.ts), reutilizado para el
 * Excel administrativo de este mismo módulo (ver
 * src/app/api/empresas/[slug]/tms/viaticos/por-pagar/exportar/route.ts).
 *
 * La documentación pública de Bi Banking/GuateACH describe un ingreso por
 * archivo con formato configurable (columnas/orden definidos por convenio
 * con el banco), pero este repositorio no contiene el layout exacto de
 * SITSA (número de convenio, orden de columnas, código de banco, etc.).
 * Por instrucción explícita: NO se inventa ese layout. Esta capa expone
 * una función genérica, delimitada y configurable (columnas + separador +
 * salto de línea) que hoy produce un CSV de control con las columnas
 * disponibles del modelo, y que se puede reconfigurar a la especificación
 * real en cuanto se tenga el convenio — sin tocar el resto del flujo de
 * viáticos.
 *
 * PENDIENTE (bloqueante para producción bancaria real): layout exacto del
 * convenio Bi Banking/GuateACH de SITSA (orden de columnas, ancho fijo vs.
 * delimitado, código de banco/sucursal, encabezado/pie de lote, encoding).
 */

export type ColumnaExportBanco = {
  /** Encabezado de la columna (se usa como header si `incluirEncabezado`). */
  titulo: string;
  /** Extrae el valor de texto para esa columna a partir de una fila. */
  valor: (r: ViaticoPorPagar) => string;
};

export type OpcionesExportBanco = {
  delimitador?: string; // por defecto ","
  saltoDeLinea?: string; // por defecto "\r\n" (compatible Windows/bancos)
  incluirEncabezado?: boolean; // por defecto true
  columnas?: ColumnaExportBanco[]; // por defecto DEFAULT_COLUMNAS_BANCO
};

function csvEscape(v: string, delimitador: string): string {
  if (v.includes(delimitador) || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/**
 * Columnas por defecto — control genérico, NO el layout oficial del banco.
 * Ajustar/reemplazar vía `opciones.columnas` en cuanto se defina el
 * convenio real.
 */
export const DEFAULT_COLUMNAS_BANCO: ColumnaExportBanco[] = [
  { titulo: "codigo_empleado", valor: (r) => r.personalCodigo ?? "" },
  { titulo: "nombre", valor: (r) => r.personalNombre },
  { titulo: "banco", valor: (r) => r.banco ?? "" },
  { titulo: "tipo_cuenta", valor: (r) => r.tipoCuenta ?? "" },
  { titulo: "numero_cuenta", valor: (r) => r.cuentaBancaria ?? "" },
  { titulo: "monto", valor: (r) => r.montoAsignado.toFixed(2) },
  { titulo: "referencia", valor: (r) => `${r.planCodigo} · viatico ${r.rol}` },
];

/**
 * Genera el contenido (texto plano) del archivo bancario genérico. El
 * llamador decide la extensión (.csv/.txt) y el Content-Type de la
 * respuesta — esta función solo arma el texto delimitado.
 */
export function generarArchivoBancoGenerico(
  items: ViaticoPorPagar[],
  opciones: OpcionesExportBanco = {},
): string {
  const delimitador = opciones.delimitador ?? ",";
  const salto = opciones.saltoDeLinea ?? "\r\n";
  const incluirEncabezado = opciones.incluirEncabezado ?? true;
  const columnas = opciones.columnas ?? DEFAULT_COLUMNAS_BANCO;

  const lineas: string[] = [];
  if (incluirEncabezado) {
    lineas.push(columnas.map((c) => csvEscape(c.titulo, delimitador)).join(delimitador));
  }
  for (const item of items) {
    lineas.push(
      columnas.map((c) => csvEscape(c.valor(item), delimitador)).join(delimitador),
    );
  }
  return lineas.join(salto) + salto;
}
