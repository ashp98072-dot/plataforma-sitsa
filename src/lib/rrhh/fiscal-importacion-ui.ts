/**
 * IMPORTACIÓN MASIVA de acumulados fiscales iniciales (Excel) — tipos y lógica PURA compartida entre servidor y UI
 * (sin exceljs ni BD, para no engordar el bundle del cliente). Reutiliza el flujo de la ficha (PR #360): la importación crea
 * BORRADORES de ACUMULADO_INICIAL_MIGRACION; NUNCA confirma. La confirmación sigue siendo individual y auditada.
 *
 * PERMISOS (sin permiso nuevo): RRHH · configuracion · crear (mismo que la captura individual). La plantilla se descarga con
 * configuracion · ver.
 */
export const HOJA_ACUMULADOS = "Acumulados";
export const MAX_BYTES_ACUMULADOS = 5 * 1024 * 1024;
export const MAX_FILAS_ACUMULADOS = 2000;

/** Columnas EXACTAS de la plantilla, en orden (A..K). */
export const COLUMNAS_ACUMULADOS = [
  "Código empleado", "DPI", "Nombre empleado", "Ejercicio", "Fecha de corte", "Ingresos gravados acumulados",
  "Ingresos exentos acumulados", "IGSS laboral acumulado", "ISR retenido acumulado", "Referencia / origen", "Observaciones",
] as const;

export const nombrePlantilla = (ejercicio: number) => `Acumulados_Fiscales_Migracion_${ejercicio}.xlsx`;

export type EstadoFilaAcumulado = "VALIDA" | "ADVERTENCIA" | "ERROR";
export type FilaAnalisis = {
  numeroFila: number;
  empleadoId: number | null;
  codigo: string;
  dpi: string;
  nombre: string;
  ejercicio: number | null;
  fechaCorte: string | null;
  gravado: string | null;
  exento: string | null;
  igss: string | null;
  isr: string | null;
  referencia: string;
  observaciones: string;
  estado: EstadoFilaAcumulado;
  mensajes: string[];
};
export type ResultadoAnalisis = {
  totalFilas: number;
  validas: number;
  advertencias: number;
  errores: number;
  /** Filas de la plantilla prellenada sin ningún dato fiscal (columnas E–K vacías): se omiten, no son error. */
  omitidasSinDatos: number;
  filas: FilaAnalisis[];
};

export const resumenAnalisis = (filas: FilaAnalisis[], omitidasSinDatos = 0): ResultadoAnalisis => ({
  totalFilas: filas.length,
  validas: filas.filter((f) => f.estado === "VALIDA").length,
  advertencias: filas.filter((f) => f.estado === "ADVERTENCIA").length,
  errores: filas.filter((f) => f.estado === "ERROR").length,
  omitidasSinDatos,
  filas,
});

/** Importar solo si hay filas importables y NINGUNA con error (las advertencias son informativas). */
export const puedeImportar = (r: ResultadoAnalisis | null | undefined): boolean =>
  !!r && r.errores === 0 && r.validas + r.advertencias > 0;

export const cantidadAImportar = (r: ResultadoAnalisis) => r.validas + r.advertencias;

export const textoConfirmacionImportacion = (n: number) =>
  `Se crearán ${n} borradores de acumulado fiscal inicial. Ninguno quedará confirmado automáticamente. ¿Deseas continuar?`;
export const textoExito = (n: number) =>
  `Se importaron ${n} borradores. Debes revisar y confirmar los acumulados fiscales antes de generar planillas que dependan de ellos.`;
export const TEXTO_PASO_PLANTILLA =
  "Usa los acumulados del sistema anterior hasta el último día incluido en el corte. No incluyas planillas que ya fueron procesadas en este sistema.";

export const formatoTamano = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export const urlPlantilla = (slug: string, ejercicio: number) => `/api/empresas/${slug}/rrhh/fiscal/acumulados/plantilla?ejercicio=${ejercicio}`;
export const urlImportar = (slug: string) => `/api/empresas/${slug}/rrhh/fiscal/acumulados/importar`;

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type RespuestaAnalisis = { tipo: "ok"; analisis: ResultadoAnalisis } | { tipo: "error"; error: string; analisis?: ResultadoAnalisis };
export type RespuestaImportacion = { tipo: "ok"; importados: number } | { tipo: "error"; error: string; analisis?: ResultadoAnalisis };

function cuerpo(archivo: Blob, nombre: string, modo: "analizar" | "importar"): FormData {
  const f = new FormData();
  f.set("file", archivo, nombre);
  f.set("modo", modo);
  return f;
}

/** Análisis (dry-run): NO escribe nada. */
export async function analizarArchivo(fetchFn: FetchFn, slug: string, archivo: Blob, nombre: string): Promise<RespuestaAnalisis> {
  try {
    const res = await fetchFn(urlImportar(slug), { method: "POST", body: cuerpo(archivo, nombre, "analizar") });
    const data = (await res.json().catch(() => ({}))) as { analisis?: ResultadoAnalisis; error?: string };
    if (!res.ok || !data.analisis) return { tipo: "error", error: data.error ?? "No se pudo analizar el archivo." };
    return { tipo: "ok", analisis: data.analisis };
  } catch {
    return { tipo: "error", error: "Error de conexión al analizar el archivo." };
  }
}

/** Importación real: el SERVIDOR vuelve a analizar el archivo y revalida todo dentro de UNA transacción (todo o nada). */
export async function importarArchivo(fetchFn: FetchFn, slug: string, archivo: Blob, nombre: string): Promise<RespuestaImportacion> {
  try {
    const res = await fetchFn(urlImportar(slug), { method: "POST", body: cuerpo(archivo, nombre, "importar") });
    const data = (await res.json().catch(() => ({}))) as { importados?: number; error?: string; analisis?: ResultadoAnalisis };
    if (!res.ok) return { tipo: "error", error: data.error ?? "No se pudo importar. No se guardó nada.", analisis: data.analisis };
    return { tipo: "ok", importados: Number(data.importados ?? 0) };
  } catch {
    return { tipo: "error", error: "Error de conexión al importar. No se guardó nada." };
  }
}
