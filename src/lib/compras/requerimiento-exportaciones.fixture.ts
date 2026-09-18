import type { DetalleCompra } from "./requerimiento-schema";
import { codificarPngRgba } from "@/lib/firmas/reforzar-firma-pdf";
export const compraReporteFixture: DetalleCompra = {
  id: 12, codigo: "RC-2026-000012", fecha_requerimiento: "2026-09-18", estado: "Pendiente", version: 2,
  entidad_requirente_id: 4, entidad_requirente_nombre: "Requirente Histórico, S.A.",
  requirente_usuario_id: 2, requirente_nombre: "José López", solicitante_usuario_id: 3, solicitante_nombre: "María Peña",
  encargado_compras_usuario_id: 5, encargado_compras_nombre: "Ana Muñoz", observaciones: "Revisión de vehículo y piñón.",
  total: "1250.75", cantidad_lineas: 2, autorizante_usuario_id: 6, autorizante_nombre: "Gerente Histórico",
  autorizado_en: "2026-09-18 10:15:00", rechazado_en: "2026-09-18 10:20:00", motivo_rechazo: "Presupuesto insuficiente.",
  lineas: [1, 2].map(i => ({
    id: i, vehiculo_id: i === 1 ? 7 : null, unidad_descripcion: i === 1 ? "C-123ABC · Cabezal histórico" : "Taller manual",
    fecha: "2026-09-17", serie_factura: "Serie A", numero_factura: `0000${i}`, proveedor_id: 9,
    proveedor_nombre_snapshot: "Proveedor Histórico", proveedor_razon_social_snapshot: "Comercial Antigua, S.A.",
    proveedor_nit_snapshot: "12345-6", banco_snapshot: "Banco", numero_cuenta_snapshot: "00001234", dias_credito_snapshot: 30,
    repuesto_descripcion: i === 1 ? "Piñón y transmisión" : "Reparación de cañería", metodo_pago: "Tarjeta de crédito",
    condicion_pago: "Contado" as const, total: i === 1 ? "1000.50" : "250.25", observaciones: "Entrega en taller.",
  })),
};
// Trazo sintético de prueba, no firma de una persona ni acceso a Mi firma.
const rgba = new Uint8Array(120 * 45 * 4);
for (let x = 5; x < 115; x++) {
  const y = 12 + Math.round(12 * Math.sin(x / 7));
  for (let dy = 0; dy < 2; dy++) rgba[((y + dy) * 120 + x) * 4 + 3] = 255;
}
export const pngFirmaFixture = codificarPngRgba(120, 45, rgba);
