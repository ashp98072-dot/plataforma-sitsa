import type { PoolConnection } from "mysql2/promise";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES, sha256Hex } from "@/lib/firmas/imagen-firma";
import { guardarUpload } from "@/lib/uploads";
import { registrarAuditoriaTx } from "@/lib/auditoria";

export const ACCIONES_FIRMAS_COMPRA = {
  requirente: "REQUERIR_COMPRA",
  encargado: "GESTIONAR_COMPRA",
} as const;

/** Copia de plantilla, no consentimiento/autorización del usuario representado.
 * El evento sin imagen invalida la asociación anterior sin borrar históricos.
 * El caller compensa TODAS las rutas registradas si no confirma la transacción.
 */
export async function capturarFirmaRolCompraTx(conn: PoolConnection, datos: {
  empresaId: number; requerimientoId: number; codigo: string; total: string;
  usuarioId: number | null; nombre: string | null; rol: keyof typeof ACCIONES_FIRMAS_COMPRA;
  registradoPor: string;
}, rutasCreadas: string[]) {
  const accion = ACCIONES_FIRMAS_COMPRA[datos.rol];
  const plantilla = datos.usuarioId === null ? null : await leerBytesFirmaGuardada(datos.usuarioId);
  let firmaId: number | null = null;
  if (plantilla && plantilla.bytes.byteLength <= MAX_FIRMA_IMAGEN_BYTES && esPngValido(Buffer.from(plantilla.bytes))) {
    const archivo = await guardarUpload(datos.empresaId, "firmas", `firma_compra_${datos.rol}_${datos.requerimientoId}`, {
      name: plantilla.original || "firma.png", size: plantilla.bytes.byteLength,
      arrayBuffer: async () => plantilla.bytes,
    });
    rutasCreadas.push(archivo.relative);
    const firma = await crearFirmaInterna(conn, {
      empresaId: datos.empresaId, usuarioId: datos.usuarioId!, empleadoId: null,
      nombreFirmante: datos.nombre || "Sin dato histórico", rolFirmante: datos.rol === "requirente" ? "REQUIRIENTE" : "ENCARGADO_COMPRAS",
      modulo: "COMPRAS", entidadTipo: "REQUERIMIENTO_COMPRA", entidadId: datos.requerimientoId,
      accion, metodo: "FIRMA_MANUSCRITA", origenFirma: "GUARDADA",
      valoresRelevantes: { requerimientoId: datos.requerimientoId, codigo: datos.codigo, total: datos.total,
        rolFuncional: datos.rol === "requirente" ? "REQUIRIENTE" : "ENCARGADO_COMPRAS", capturaPlantilla: true },
      imagen: { ...archivo, mime: "image/png", sha256: sha256Hex(plantilla.bytes) },
    });
    firmaId = firma.id;
  }
  await registrarAuditoriaTx(conn, {
    empresaId: datos.empresaId, usuario: datos.registradoPor, modulo: "compras_requerimientos",
    accion: `capturar_${accion.toLowerCase()}`,
    detalle: JSON.stringify({ requerimientoId: datos.requerimientoId, usuarioId: datos.usuarioId, firmaId }),
  });
}
