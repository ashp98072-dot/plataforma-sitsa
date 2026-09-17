export const METODOS_PAGO_COMPRAS = ["Efectivo", "Transferencia", "Transferencia móvil", "Tarjeta de crédito", "Cheque", "Otro"] as const;

/** No modifica el catálogo original. Los valores no reconocidos conservan su texto. */
export function normalizarMetodoPagoCompra(valor: string | null | undefined): string | null {
  const texto = valor?.trim();
  if (!texto) return null;
  const clave = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  if (["tarjeta", "tarjeta de credito", "tarjeta credito"].includes(clave)) return "Tarjeta de crédito";
  return METODOS_PAGO_COMPRAS.find(m => m.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === clave) ?? texto;
}

/** Se llama únicamente desde el evento de selección: nunca al cargar catálogos/formulario. */
export function seleccionarProveedorCompra<T extends { proveedor_id: number; metodo_pago: string }>(linea: T, proveedorId: number, habitual?: string | null): T {
  if (linea.proveedor_id === proveedorId) return linea;
  return { ...linea, proveedor_id: proveedorId, metodo_pago: normalizarMetodoPagoCompra(habitual) ?? linea.metodo_pago };
}
