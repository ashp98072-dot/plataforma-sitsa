import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/**
 * VIATICOS-HISTORIAL-FIRMA-1 — lado de LECTURA de `firmas_electronicas`,
 * separado a propósito de firmas-internas.ts (ese archivo es
 * exclusivamente de ESCRITURA — "tabla de solo-inserción a nivel de
 * aplicación", ver su JSDoc). No se crea columna nueva: todo lo que no
 * tiene columna propia (nombreFirmante/rolFirmante/origenFirma) se
 * parsea desde `payload_canonico`, el mismo JSON que crearFirmaInterna()
 * ya escribe (ver payloadCanonicoJson en firmas-internas.ts).
 *
 * Solo expone los campos necesarios para VISUALIZAR — nunca
 * imagen_ruta (ruta física), payload_canonico completo, ip, user_agent
 * ni sesion_id (ver sección 10 del ticket).
 */

/** origenFirma tal como lo escribe crearFirmaInterna(): null para firmas sin imagen o previas a MI-FIRMA-1 — nunca se inventa un tercer valor. */
export type OrigenFirma = "GUARDADA" | "DIBUJADA" | null;

export type FirmaViaticoResumen = {
  id: number;
  /** 'AUTORIZAR_VIATICO' | 'LIQUIDAR_VIATICO' (ver ACCIONES_VIATICO). */
  accion: string;
  codigoFirma: string;
  fechaHoraServidor: string;
  /** 'PASSWORD' | 'FIRMA_MANUSCRITA' (columna real, nunca inferido). */
  metodo: string;
  usuarioId: number | null;
  empleadoId: number | null;
  /** Snapshot al momento de firmar (parseado de payload_canonico) — nunca el nombre/rol ACTUAL del usuario, que puede haber cambiado desde entonces. */
  nombreFirmante: string | null;
  rolFirmante: string | null;
  origenFirma: OrigenFirma;
  tieneImagen: boolean;
  hashPayload: string;
};

/** Acciones de firma reales de Viáticos — nunca se listan firmas de otros módulos (ver filtro modulo/entidad_tipo abajo). */
export const ACCIONES_VIATICO = ["AUTORIZAR_VIATICO", "LIQUIDAR_VIATICO"] as const;

/**
 * Parseo SEGURO de payload_canonico: un JSON corrupto o un payload
 * antiguo sin `origenFirma` (previo a MI-FIRMA-1) nunca debe tumbar el
 * historial — se degrada a `null` en cada campo que falte, JAMÁS se
 * inventa un valor por defecto distinto (ver ticket: "usar null, no
 * inventar").
 */
function parsearCamposPayload(payloadCanonico: string): {
  nombreFirmante: string | null;
  rolFirmante: string | null;
  origenFirma: OrigenFirma;
} {
  try {
    const obj = JSON.parse(payloadCanonico) as Record<string, unknown>;
    const nombreFirmante = typeof obj.nombreFirmante === "string" ? obj.nombreFirmante : null;
    const rolFirmante = typeof obj.rolFirmante === "string" ? obj.rolFirmante : null;
    const origenFirmaRaw = obj.origenFirma;
    const origenFirma: OrigenFirma =
      origenFirmaRaw === "GUARDADA" || origenFirmaRaw === "DIBUJADA" ? origenFirmaRaw : null;
    return { nombreFirmante, rolFirmante, origenFirma };
  } catch {
    return { nombreFirmante: null, rolFirmante: null, origenFirma: null };
  }
}

function mapFirmaViatico(r: RowDataPacket): FirmaViaticoResumen {
  const campos = parsearCamposPayload(String(r.payload_canonico ?? "{}"));
  return {
    id: Number(r.id),
    accion: String(r.accion),
    codigoFirma: String(r.codigo_firma),
    fechaHoraServidor: String(r.fecha_hora_servidor),
    metodo: String(r.metodo),
    usuarioId: r.usuario_id != null ? Number(r.usuario_id) : null,
    empleadoId: r.empleado_id != null ? Number(r.empleado_id) : null,
    nombreFirmante: campos.nombreFirmante,
    rolFirmante: campos.rolFirmante,
    origenFirma: campos.origenFirma,
    tieneImagen: r.imagen_ruta != null,
    hashPayload: String(r.hash_payload),
  };
}

/**
 * Historial de firmas de UN viático (autorización + liquidación, si ya
 * ocurrieron) — orden cronológico ascendente (autorización siempre antes
 * que liquidación, si ambas existen). `empresaId` viene SIEMPRE de la
 * sesión del servidor (el endpoint lo obtiene de requireTenantViaticosAny,
 * nunca del cliente) — junto con `modulo = 'VIATICOS' AND entidad_tipo =
 * 'VIATICO'`, garantiza que nunca se devuelva una firma de otro módulo ni
 * de otra empresa, aunque `viaticoId` (entidad_id) coincidiera por
 * casualidad con el id de un registro de otra empresa/módulo.
 *
 * No valida aquí que el viático (tms_viaticos) exista/pertenezca a la
 * empresa — esa validación ya vive en el endpoint (mismo patrón que el
 * resto de endpoints de viáticos, ver route.ts) para poder responder 404
 * en vez de una lista vacía silenciosa cuando el id no existe.
 */
export async function listarFirmasViatico(
  empresaId: number,
  viaticoId: number,
): Promise<FirmaViaticoResumen[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, accion, codigo_firma, fecha_hora_servidor, metodo, usuario_id, empleado_id,
            payload_canonico, hash_payload, imagen_ruta
     FROM firmas_electronicas
     WHERE empresa_id = ? AND modulo = 'VIATICOS' AND entidad_tipo = 'VIATICO' AND entidad_id = ?
     ORDER BY fecha_hora_servidor ASC, id ASC`,
    [empresaId, viaticoId],
  );
  return rows.map(mapFirmaViatico);
}
