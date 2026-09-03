import { tablaAPdf } from "@/lib/rrhh/export-files";
import { listarViaticosControl } from "@/lib/tms/viaticos";
import { listarFirmasViatico } from "@/lib/firmas/firmas-lectura";

/**
 * VIATICOS-COMPROBANTE-PDF — comprobante en PDF, en lote, de todos los
 * viáticos actualmente AUTORIZADOS de una empresa: una tabla (no una
 * página por viático) con los datos del viaje/empleado/monto y quién
 * autorizó, igual que se ve la bandeja "Autorizados" en la plataforma.
 *
 * Reutiliza TAL CUAL:
 * - listarViaticosControl() — misma consulta que ya usa el Control de
 *   Viáticos (VIAT-3), filtrada a estado AUTORIZADO — no es una segunda
 *   fuente de verdad del listado.
 * - listarFirmasViatico() — mismo historial de firmas que ya expone el
 *   modal "Ver firmas" (VIATICOS-HISTORIAL-FIRMA-1).
 * - tablaAPdf() (src/lib/rrhh/export-files.ts) — el mismo generador de
 *   tablas en PDF ya usado en reportes de RRHH: paginación automática,
 *   encabezado/pie de página, y celdaPdf() ya normaliza fechas
 *   (Date.toString() del motor JS incluido) sin inventar un formateo
 *   propio aquí.
 *
 * El código de firma queda en la tabla como referencia trazable; el hash
 * completo y la imagen de la firma (si existe) siguen disponibles en el
 * sistema vía "Ver firmas" — este comprobante es un listado imprimible,
 * no reemplaza esa vista de detalle.
 */

function moneda(v: number): string {
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * `null` cuando no hay ningún viático AUTORIZADO — el caller (route.ts)
 * decide el mensaje/estado HTTP; esta función nunca genera un PDF vacío.
 */
export async function comprobanteAutorizacionesPdf(
  empresaId: number,
  empresaNombre: string,
): Promise<Buffer | null> {
  const { items } = await listarViaticosControl(empresaId, { estado: "AUTORIZADO" });
  if (!items.length) return null;

  const filas = await Promise.all(
    items.map(async (v) => {
      const firmas = await listarFirmasViatico(empresaId, v.id);
      const firma = firmas.find((f) => f.accion === "AUTORIZAR_VIATICO") ?? null;
      return [
        v.planCodigo,
        v.fechaPlan,
        v.cliente ?? "—",
        v.personalNombre,
        v.rol,
        moneda(v.montoAsignado),
        firma?.nombreFirmante ?? "No disponible",
        firma?.fechaHoraServidor ?? "—",
        firma?.codigoFirma ?? "—",
      ];
    }),
  );

  return tablaAPdf({
    title: empresaNombre,
    subtitle: `Comprobante de autorización de viáticos — TMS / Logística · ${items.length} viático(s) autorizado(s)`,
    headers: [
      "Viaje",
      "Fecha",
      "Cliente",
      "Empleado",
      "Rol",
      "Monto",
      "Autorizado por",
      "Fecha autorización",
      "Código de firma",
    ],
    rows: filas,
    layout: "landscape",
    modo: "tabla",
  });
}
