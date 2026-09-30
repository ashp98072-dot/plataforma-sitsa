import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { cerrarViaje, cerrarViajeManual } from "@/lib/tms/cierre-viaje";
import { motivoNoCierreManual, motivoNoCierreNormal, puedeCerrarManualmente, puedeCerrarNormalmente } from "@/lib/tms/cierre-viaje-shared";
import { resolverPeriodoPlanes, type AgrupacionPlanes } from "@/lib/tms/planes-periodo";
import { obtenerCandidatosCierre, type FiltrosReporteViajes } from "@/lib/tms/reportes-viajes";

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

/** PLANES-CIERRE-PERIODO — subconjunto de filtros que respeta el cierre por período (ver obtenerCandidatosCierre: deliberadamente SIN soloPendientesCierre/soloCerrados/soloSinCerrar ni fechaDesde/fechaHasta — el período los fija). */
export type FiltrosCierrePeriodo = Pick<
  FiltrosReporteViajes,
  "clienteId" | "pilotoId" | "unidadId" | "estado" | "ruta" | "estadoFacturacion" | "estadoCobro"
>;

export type ResultadoCierreMasivoPeriodo = ResultadoCierreMasivo & {
  agrupacion: AgrupacionPlanes;
  valor: string;
  etiqueta: string;
};

/**
 * PLANES-CIERRE-PERIODO — cierre masivo por Día/Semana/Mes, más allá de la página cargada por el cliente.
 *
 * Reglas obligatorias (ticket "PLANES / VIAJES: AGRUPAR Y CERRAR POR DÍA / SEMANA / MES"):
 *  - Al confirmar, SIEMPRE vuelve a resolver los candidatos DESDE LA BASE DE DATOS (obtenerCandidatosCierre) —
 *    nunca acepta una lista de ids del caller/cliente. Si un viaje cambió de estado entre que el usuario abrió
 *    el modal de confirmación y este momento, cerrarViajesMasivo() (reutilizado sin cambios) lo vuelve a
 *    validar por su cuenta y lo deja "omitido" con su motivo — nunca fuerza el cierre.
 *  - Respeta los MISMOS filtros activos que el listado (cliente/piloto/unidad/estado/ruta/facturación/cobro) —
 *    reutiliza obtenerCandidatosCierre/construirCondiciones, nunca un WHERE propio duplicado.
 *  - Sin tope de 200 visible al usuario: si el período tiene más candidatos que MAX_PLANES_CIERRE_MASIVO, se
 *    divide en lotes ≤200 y se procesan SECUENCIALMENTE con la MISMA cerrarViajesMasivo() (sin transacción
 *    global — cada lote, y cada viaje dentro de cada lote, conserva su propia atomicidad), combinando
 *    cerrados/omitidos/errores de todos los lotes en un solo resultado.
 *  - Auditoría: cada lote ya audita su propio resumen `cierre_masivo_viajes` (vía cerrarViajesMasivo, con
 *    `grupo` = "<AGRUPACION> <valor>"); además se agrega UN resumen `cierre_masivo_viajes_periodo` con los
 *    TOTALES combinados de todos los lotes — para que el período completo quede auditado como una sola
 *    operación lógica, sin perder el detalle por lote.
 */
export async function cerrarViajesMasivoPorPeriodo(opts: {
  empresaId: number;
  usuario: string;
  tipo: TipoCierreMasivo;
  agrupacion: AgrupacionPlanes;
  valor: string;
  filtros?: FiltrosCierrePeriodo;
  motivo?: string;
  comentario?: string | null;
}): Promise<ResultadoCierreMasivoPeriodo | { error: string }> {
  const periodo = resolverPeriodoPlanes(opts.agrupacion, opts.valor);
  if (!periodo) return { error: "Valor de período inválido." };

  // Re-resolución FRESCA de candidatos — nunca reutiliza ids calculados antes de este momento.
  const candidatos = await obtenerCandidatosCierre(opts.empresaId, {
    ...opts.filtros,
    fechaDesde: periodo.desde,
    fechaHasta: periodo.hasta,
  });
  const ids = candidatos
    .filter((c) => (opts.tipo === "NORMAL" ? puedeCerrarNormalmente(c.estado, c.llegadaRegistrada) : puedeCerrarManualmente(c.estado)))
    .map((c) => c.id);

  const grupo = `${opts.agrupacion} ${periodo.clave}`;
  const cerrados: ItemCierreMasivo[] = [];
  const omitidos: ItemCierreMasivoConMotivo[] = [];
  const errores: ItemCierreMasivoConMotivo[] = [];

  for (let i = 0; i < ids.length; i += MAX_PLANES_CIERRE_MASIVO) {
    const lote = ids.slice(i, i + MAX_PLANES_CIERRE_MASIVO);
    // Secuencial a propósito: sin transacción global, cada lote se procesa de forma independiente.
    const r = await cerrarViajesMasivo({
      empresaId: opts.empresaId,
      usuario: opts.usuario,
      tipo: opts.tipo,
      planIds: lote,
      motivo: opts.motivo,
      comentario: opts.comentario,
      grupo,
    });
    cerrados.push(...r.cerrados);
    omitidos.push(...r.omitidos);
    errores.push(...r.errores);
  }

  // Resumen del PERÍODO completo (combinado de todos los lotes) — además del resumen por lote que ya audita
  // cada llamada a cerrarViajesMasivo() arriba.
  try {
    await registrarAuditoria({
      empresaId: opts.empresaId,
      usuario: opts.usuario,
      accion: "cierre_masivo_viajes_periodo",
      modulo: "tms",
      detalle: `Cierre masivo ${opts.tipo} · ${grupo} · solicitados ${ids.length} · cerrados ${cerrados.length} · omitidos ${omitidos.length} · errores ${errores.length}`
        + `${opts.tipo === "MANUAL" ? ` · motivo común: ${(opts.motivo ?? "").trim()}${opts.comentario?.trim() ? ` · comentario: ${opts.comentario.trim()}` : ""}` : ""}`,
    });
  } catch (e) {
    console.error("auditoría resumen del cierre masivo por período", e);
  }

  return { tipo: opts.tipo, solicitados: ids.length, cerrados, omitidos, errores, agrupacion: opts.agrupacion, valor: periodo.clave, etiqueta: periodo.etiqueta };
}
