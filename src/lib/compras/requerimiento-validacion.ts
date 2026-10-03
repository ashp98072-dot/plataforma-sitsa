import type { ZodError } from "zod";
import { cuerpoErrores, erroresDeZod, type CuerpoErrores, type ConfigErrores } from "@/lib/validacion-formulario";

/**
 * ERRORES DE VALIDACIÓN — Requerimientos de compra. Mismos nombres y misma palabra («Línea») que la pantalla
 * (requerimiento-form-client.tsx). Los mensajes en español escritos en el schema ya son claros y se respetan.
 */
export const CONFIG_REQUERIMIENTO_COMPRA: ConfigErrores = {
  etiquetas: {
    fecha_requerimiento: "Fecha de requerimiento",
    entidad_requirente_id: "Empresa requirente",
    requirente_usuario_id: "Requirente",
    encargado_compras_usuario_id: "Encargado de compras",
    observaciones: "Observaciones",
    version: "Versión",
    lineas: "Líneas",
    "lineas.id": "Línea",
    "lineas.vehiculo_id": "Unidad",
    "lineas.unidad_descripcion": "Descripción manual de unidad",
    "lineas.fecha": "Fecha",
    "lineas.serie_factura": "Serie factura",
    "lineas.numero_factura": "Número factura",
    "lineas.proveedor_id": "Proveedor",
    "lineas.repuesto_descripcion": "Repuesto a comprar",
    "lineas.metodo_pago": "Método de pago",
    "lineas.condicion_pago": "Condición de pago",
    "lineas.total": "Total",
    "lineas.observaciones": "Observaciones",
  },
  colecciones: { lineas: "Línea" },
  mensajes: {
    fecha_requerimiento: { requerido: "la fecha es obligatoria.", formato: "usa una fecha válida." },
    entidad_requirente_id: { requerido: "selecciona la empresa requirente.", positivo: "selecciona la empresa requirente.", invalido: "selecciona la empresa requirente." },
    requirente_usuario_id: { requerido: "selecciona un requirente.", positivo: "selecciona un requirente.", invalido: "selecciona un requirente." },
    "lineas.proveedor_id": { requerido: "selecciona un proveedor.", positivo: "selecciona un proveedor.", invalido: "selecciona un proveedor." },
    "lineas.condicion_pago": { requerido: "selecciona Contado o Crédito.", opcion: "selecciona Contado o Crédito." },
    "lineas.fecha": { requerido: "la fecha es obligatoria.", formato: "usa una fecha válida." },
  },
  moneda: ["total"],
  // Mensajes del schema que son técnicos (DECIMAL) o no dicen de qué fecha se trata.
  traducciones: {
    "Fecha no válida.": "usa una fecha válida.",
    "El total debe ser positivo, con máximo dos decimales y compatible con DECIMAL(12,2).": "debe ser mayor que Q0, con máximo dos decimales.",
    "El total del requerimiento supera DECIMAL(12,2).": "El total del requerimiento es demasiado grande.",
    "Hay IDs de líneas repetidos.": "Hay líneas repetidas. Recarga el requerimiento e inténtalo de nuevo.",
    "Las líneas nuevas no pueden incluir ID.": "Las líneas nuevas no pueden traer identificador. Recarga la página e inténtalo de nuevo.",
    "El formulario contiene campos no permitidos.": "El formulario contiene datos que no se pueden procesar.",
  },
};

export function cuerpoErroresRequerimiento(error: ZodError, payload: unknown): CuerpoErrores {
  return cuerpoErrores(erroresDeZod(error, CONFIG_REQUERIMIENTO_COMPRA, payload));
}
