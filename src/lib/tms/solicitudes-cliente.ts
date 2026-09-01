/**
 * CLIENTE-PORTAL-1 — piezas reutilizables para tms_solicitudes_cliente /
 * tms_solicitud_paradas (ver sql/migrate-2026-09-tms-portal-clientes-base.sql).
 *
 * A propósito este módulo NO incluye todavía CRUD de solicitudes ni
 * transiciones de estado — eso es CLIENTE-PORTAL-2/3 (ver
 * docs/CLIENTE-PORTAL-0-DISCOVERY-SOLICITUDES-SEGUIMIENTO.md, fuera del
 * alcance de este ticket). Lo único que este ticket pide preparar aquí es
 * la lista cerrada de tipos de parada y su validador, para que la tabla
 * nueva NUNCA pueda terminar con un `tipo` fuera de los 3 valores
 * esperados — a diferencia del legado tms_plan_paradas.tipo (VARCHAR
 * libre, sin ningún validador reutilizable).
 */

export const TIPOS_SOLICITUD_PARADA = ["Carga", "Entrega", "Descarga"] as const;
export type TipoSolicitudParada = (typeof TIPOS_SOLICITUD_PARADA)[number];

export function esTipoSolicitudParadaValido(
  tipo: string,
): tipo is TipoSolicitudParada {
  return (TIPOS_SOLICITUD_PARADA as readonly string[]).includes(tipo);
}

export type SolicitudParadaInput = {
  orden: number;
  tipo: string;
  lugarNombre: string;
  clienteUbicacionId?: number | null;
  referencia?: string | null;
};

export type ResultadoValidacionParadas =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Reglas mínimas que el modelo debe soportar (ticket, sección A.3):
 * exactamente 1 `Carga`, 0..N `Entrega`, exactamente 1 `Descarga`, ningún
 * tipo fuera de la lista cerrada, y sin dos paradas con el mismo `orden`.
 * Puramente sincrónica y sin acceso a base de datos — reutilizable tanto
 * en un futuro endpoint de creación como en un formulario del lado
 * cliente antes de enviar.
 */
export function validarParadasSolicitud(
  paradas: SolicitudParadaInput[],
): ResultadoValidacionParadas {
  if (!paradas.length) {
    return { ok: false, error: "La solicitud debe incluir al menos origen y destino." };
  }

  for (const p of paradas) {
    if (!esTipoSolicitudParadaValido(p.tipo)) {
      return { ok: false, error: `Tipo de parada no permitido: "${p.tipo}".` };
    }
    if (!p.lugarNombre?.trim()) {
      return { ok: false, error: "Cada parada necesita un lugar." };
    }
  }

  const ordenes = paradas.map((p) => p.orden);
  if (new Set(ordenes).size !== ordenes.length) {
    return { ok: false, error: "No puede haber dos paradas con el mismo orden." };
  }

  const cargas = paradas.filter((p) => p.tipo === "Carga").length;
  const descargas = paradas.filter((p) => p.tipo === "Descarga").length;
  if (cargas !== 1) {
    return {
      ok: false,
      error: cargas === 0
        ? "La solicitud debe incluir exactamente un origen (Carga)."
        : "La solicitud no puede tener más de un origen (Carga).",
    };
  }
  if (descargas !== 1) {
    return {
      ok: false,
      error: descargas === 0
        ? "La solicitud debe incluir exactamente un destino final (Descarga)."
        : "La solicitud no puede tener más de un destino final (Descarga).",
    };
  }

  return { ok: true };
}

/**
 * `cantidad_entregas` nunca se guarda como columna (ver discovery §8) —
 * siempre se deriva contando `tipo === "Entrega"`.
 */
export function contarEntregas(paradas: { tipo: string }[]): number {
  return paradas.filter((p) => p.tipo === "Entrega").length;
}
