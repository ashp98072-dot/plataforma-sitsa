import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { cerrarViaje, cerrarViajeManual } from "@/lib/tms/cierre-viaje";
import { motivoNoCierreManual, motivoNoCierreNormal } from "@/lib/tms/cierre-viaje-shared";

/**
 * TMS-CIERRE-MASIVO-1 — cierre masivo por lote desde Planes / Viajes.
 *
 * NO reimplementa ninguna regla de cierre: cada viaje se procesa UNO POR UNO
 * con la MISMA función del cierre individual (cerrarViaje / cerrarViajeManual),
 * que ya son atómicas por viaje. No hay transacción global: un viaje que no
 * puede cerrarse (o que falla) no impide cerrar los demás, y los cierres ya
 * hechos nunca se revierten. Cada viaje conserva su auditoría individual
 * (cerrar_viaje / cerrar_viaje_manual); aquí solo se agrega el resumen
 * `cierre_masivo_viajes`. El permiso viajes_cerrar:editar y la empresa
 * (siempre de la sesión) los resuelve el endpoint.
 */
export const MAX_PLANES_CIERRE_MASIVO = 200;

export type TipoCierreMasivo = "NORMAL" | "MANUAL";
export type ItemCierreMasivo = { id: number; codigo: string };
export type ItemCierreMasivoConMotivo = ItemCierreMasivo & { motivo: string };
export type ResultadoCierreMasivo = {
  tipo: TipoCierreMasivo;
  solicitados: number;
  cerrados: ItemCierreMasivo[];
  omitidos: ItemCierreMasivoConMotivo[];
  errores: ItemCierreMasivoConMotivo[];
};

export async function cerrarViajesMasivo(opts: {
  empresaId: number;
  usuario: string;
  tipo: TipoCierreMasivo;
  planIds: number[];
  /** Solo MANUAL: común a todo el lote (ya validado 5–500 por el endpoint; cerrarViajeManual lo vuelve a validar). */
  motivo?: string;
  comentario?: string | null;
  /** Solo informativo, para la auditoría (fecha del grupo en pantalla). */
  grupo?: string | null;
}): Promise<ResultadoCierreMasivo> {
  const ids = [...new Set(opts.planIds.filter((n) => Number.isInteger(n) && n > 0))];
  const cerrados: ItemCierreMasivo[] = [];
  const omitidos: ItemCierreMasivoConMotivo[] = [];
  const errores: ItemCierreMasivoConMotivo[] = [];

  // Solo viajes de ESTA empresa: un id ajeno o inexistente nunca aparece aquí.
  const filas = ids.length
    ? await query<RowDataPacket[]>(
        `SELECT p.id, p.codigo, p.estado,
                EXISTS (
                  SELECT 1 FROM flota_viajes fv
                  WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
                ) AS llegada_registrada
         FROM tms_planes_viaje p
         WHERE p.empresa_id = ? AND p.id IN (${ids.map(() => "?").join(",")})`,
        [opts.empresaId, ...ids],
      )
    : [];
  const porId = new Map(filas.map((f) => [Number(f.id), f]));

  for (const id of ids) {
    const f = porId.get(id);
    if (!f) {
      omitidos.push({ id, codigo: "—", motivo: "Viaje no encontrado." });
      continue;
    }
    const codigo = String(f.codigo ?? `#${id}`);
    const estado = String(f.estado ?? "");
    // Elegibilidad recalculada en servidor con el MISMO criterio puro que usa la pantalla.
    const motivoNo = opts.tipo === "NORMAL"
      ? motivoNoCierreNormal(estado, Number(f.llegada_registrada) === 1)
      : motivoNoCierreManual(estado);
    if (motivoNo) {
      omitidos.push({ id, codigo, motivo: motivoNo });
      continue;
    }
    try {
      const r = opts.tipo === "NORMAL"
        ? await cerrarViaje(opts.empresaId, id, opts.usuario)
        : await cerrarViajeManual({
            empresaId: opts.empresaId,
            planId: id,
            usuario: opts.usuario,
            motivo: opts.motivo ?? "",
            comentario: opts.comentario ?? null,
          });
      if (r.ok) cerrados.push({ id, codigo });
      else omitidos.push({ id, codigo, motivo: r.error }); // el servicio lo rechazó (p. ej. cambió de estado entre tanto)
    } catch (e) {
      console.error("cierre masivo de viajes", { planId: id, tipo: opts.tipo }, e);
      errores.push({ id, codigo, motivo: "Error inesperado al cerrar este viaje." });
    }
  }

  // La auditoría resumen nunca debe ocultar el resultado de cierres ya hechos.
  try {
    await registrarAuditoria({
      empresaId: opts.empresaId,
      usuario: opts.usuario,
      accion: "cierre_masivo_viajes",
      modulo: "tms",
      detalle: `Cierre masivo ${opts.tipo}${opts.grupo ? ` · grupo ${opts.grupo}` : ""} · solicitados ${ids.length} · cerrados ${cerrados.length} · omitidos ${omitidos.length} · errores ${errores.length}`
        + `${opts.tipo === "MANUAL" ? ` · motivo común: ${(opts.motivo ?? "").trim()}${opts.comentario?.trim() ? ` · comentario: ${opts.comentario.trim()}` : ""}` : ""}`
        + `${cerrados.length ? ` · cerrados: ${cerrados.map((c) => c.codigo).join(", ")}` : ""}`,
    });
  } catch (e) {
    console.error("auditoría resumen del cierre masivo", e);
  }

  return { tipo: opts.tipo, solicitados: ids.length, cerrados, omitidos, errores };
}
