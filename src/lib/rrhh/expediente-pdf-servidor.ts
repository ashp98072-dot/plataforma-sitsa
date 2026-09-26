import { readFile, stat } from "fs/promises";
import { MAX_UPLOAD_BYTES, validarRutaArchivoEmpresa } from "@/lib/uploads";
import { formatearFechaVisible, ahoraLocal } from "@/lib/rrhh/dates";
import { listarDocumentos } from "@/lib/rrhh/documentos";
import type { Empleado } from "@/lib/rrhh/empleados";
import { MAX_FOTO_EMPLEADO } from "@/lib/rrhh/foto-empleado";
import { construirExpedientePdf, nombreArchivoExpediente, ordenarDocumentosExpediente, type EntradaDocumento } from "@/lib/rrhh/expediente-pdf";

/**
 * Límite del expediente consolidado: 2 × el máximo por archivo de RRHH (50 MB, MAX_UPLOAD_BYTES). pdf-lib arma el PDF completo en memoria
 * (varias veces el tamaño de los archivos de origen) y Hostinger corre Node con memoria acotada; con este tope un expediente típico
 * (decenas de MB) pasa y uno desmesurado se rechaza con un mensaje claro en vez de tumbar el proceso.
 */
export const MAX_EXPEDIENTE_BYTES = 2 * MAX_UPLOAD_BYTES;

export type ResultadoExpediente =
  | { ok: true; bytes: Uint8Array; filename: string; documentos: number; omitidos: number }
  | { ok: false; status: number; error: string };

/**
 * Carga los archivos del empleado y arma el PDF. Consultas SQL: UNA de documentos (listarDocumentos) — el empleado ya lo resolvió el caller
 * (por empresa). Rutas: SOLO las persistidas en BD, validadas por validarRutaArchivoEmpresa (dentro de uploads/empresas/<empresa>/); nada
 * viene del cliente. Un archivo ilegible se degrada a página informativa, sin exponer rutas ni errores técnicos.
 */
export async function prepararExpedientePdf(empresaId: number, empleado: Empleado): Promise<ResultadoExpediente> {
  const documentos = await listarDocumentos(empresaId, empleado.id);

  // Tamaños primero (sin leer): protege memoria antes de cargar nada.
  const tamanos = new Map<number, number | null>();
  let total = 0;
  for (const d of documentos) {
    const abs = validarRutaArchivoEmpresa(empresaId, d.rutaArchivo);
    let tam: number | null = null;
    if (abs) {
      try {
        const info = await stat(abs);
        if (info.isFile()) tam = info.size;
      } catch {
        tam = null;
      }
    }
    tamanos.set(d.id, tam);
    if (tam && tam <= MAX_UPLOAD_BYTES) total += tam;
  }
  if (total > MAX_EXPEDIENTE_BYTES) {
    const mb = Math.round(MAX_EXPEDIENTE_BYTES / (1024 * 1024));
    return { ok: false, status: 413, error: `El expediente supera el máximo de ${mb} MB para descargarlo en un solo PDF. Descarga los documentos por separado.` };
  }

  async function leer(id: number, ruta: string, maximo: number): Promise<Uint8Array | null> {
    const tam = tamanos.get(id);
    if (!tam || tam > maximo) return null;
    const abs = validarRutaArchivoEmpresa(empresaId, ruta);
    if (!abs) return null;
    try {
      return await readFile(abs);
    } catch {
      return null;
    }
  }

  // Foto de la portada: la más reciente tipo "Foto" (misma regla que respuestaFotoEmpleado). Opcional: si falta o no es JPG/PNG, sin foto.
  const fotos = documentos.filter((d) => d.tipoDocumento === "Foto").sort((a, b) => String(b.subidoEn).localeCompare(String(a.subidoEn)) || b.id - a.id);
  let fotoPortada: Uint8Array | null = null;
  let fotoUsadaId: number | null = null;
  for (const foto of fotos.slice(0, 1)) {
    const bytes = await leer(foto.id, foto.rutaArchivo, MAX_FOTO_EMPLEADO);
    if (bytes) {
      fotoPortada = bytes;
      fotoUsadaId = foto.id;
    }
  }

  const ordenados = ordenarDocumentosExpediente(documentos.filter((d) => d.id !== fotoUsadaId));
  const entradas: EntradaDocumento[] = [];
  for (const d of ordenados) {
    entradas.push({ doc: { id: d.id, tipoDocumento: d.tipoDocumento, nombreOriginal: d.nombreOriginal, subidoEn: d.subidoEn }, bytes: await leer(d.id, d.rutaArchivo, MAX_UPLOAD_BYTES) });
  }

  const { bytes, resumen } = await construirExpedientePdf({
    empleado: {
      codigo: empleado.codigo,
      nombre: empleado.nombre,
      dpi: empleado.dpi,
      puesto: empleado.puesto,
      categoriaOps: empleado.categoriaOps,
      estado: empleado.estado,
      fechaAlta: empleado.fechaAlta,
    },
    documentos: entradas,
    fotoPortada,
    generado: `${formatearFechaVisible(ahoraLocal().slice(0, 10))} ${ahoraLocal().slice(11, 16)}`,
  });
  return { ok: true, bytes, filename: nombreArchivoExpediente(empleado.codigo, empleado.nombre), documentos: entradas.length, omitidos: resumen.omitidos };
}
