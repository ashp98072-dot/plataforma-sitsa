import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { normalizarNombrePiloto } from "@/lib/flota/pilotos";
import { listarParadasDelPlan, type PlanParada } from "@/lib/tms/paradas";

export type PlanSalidaMatch = {
  id: number;
  codigo: string;
  fecha_plan: string;
  hora_carga: string | null;
  tipo_traslado: string | null;
  notas: string | null;
  placa: string | null;
  piloto: string | null;
  cliente: string | null;
  lugar_carga: string | null;
  lugar_descarga: string | null;
  estado: string;
  auxiliares: string[];
  paradas: PlanParada[];
};

export async function buscarPlanesParaSalida(
  empresaId: number,
  opts: { pilotoNombre?: string; placa?: string; fecha?: string },
): Promise<PlanSalidaMatch[]> {
  const fecha = (opts.fecha || new Date().toISOString().slice(0, 10)).slice(
    0,
    10,
  );
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.fecha_plan, p.hora_carga, p.tipo_traslado, p.notas, p.estado,
            u.placa, pil.nombre AS piloto, c.nombre AS cliente,
            lc.nombre AS lugar_carga, ld.nombre AS lugar_descarga
     FROM tms_planes_viaje p
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id
     LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id
     LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id
     WHERE p.empresa_id = ?
       AND p.fecha_plan = ?
       -- OPS-5.2d: "Cargado" significa "el vehículo ya fue cargado/
       -- preparado, pero TODAVÍA no ha salido" — un candidato válido de
       -- salida igual que "Programado" (marcar Cargado es opcional, no
       -- obligatorio). Cerrado/Cancelado/Descargado quedan fuera
       -- deliberadamente: ya no admiten una nueva salida.
       AND p.estado IN ('Programado', 'Cargado', 'En ruta')
     ORDER BY p.id DESC
     LIMIT 50`,
    [empresaId, fecha],
  ).catch(() => [] as RowDataPacket[]);

  const normPiloto = opts.pilotoNombre
    ? normalizarNombrePiloto(opts.pilotoNombre)
    : "";
  const placaAlt = (opts.placa || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "");

  const out: PlanSalidaMatch[] = [];
  for (const r of rows) {
    const pNorm = normalizarNombrePiloto(String(r.piloto ?? ""));
    const pPlaca = String(r.placa ?? "")
      .toUpperCase()
      .replace(/[\s-]/g, "");
    const matchPiloto = normPiloto && pNorm && pNorm === normPiloto;
    const matchPlaca = placaAlt && pPlaca && pPlaca === placaAlt;
    if (!matchPiloto && !matchPlaca) continue;

    let auxiliares: string[] = [];
    try {
      const aux = await query<RowDataPacket[]>(
        `SELECT per.nombre FROM tms_plan_auxiliares a
         INNER JOIN tms_personal per ON per.id = a.personal_id
         WHERE a.plan_id = ? ORDER BY a.orden`,
        [r.id],
      );
      auxiliares = aux.map((a) => String(a.nombre));
    } catch {
      /* ok */
    }

    const paradas = await listarParadasDelPlan(Number(r.id));
    out.push({
      id: Number(r.id),
      codigo: String(r.codigo),
      fecha_plan: String(r.fecha_plan).slice(0, 10),
      hora_carga: r.hora_carga ? String(r.hora_carga).slice(0, 8) : null,
      tipo_traslado: r.tipo_traslado ? String(r.tipo_traslado) : null,
      notas: r.notas ? String(r.notas) : null,
      placa: r.placa ? String(r.placa) : null,
      piloto: r.piloto ? String(r.piloto) : null,
      cliente: r.cliente ? String(r.cliente) : null,
      lugar_carga: r.lugar_carga ? String(r.lugar_carga) : null,
      lugar_descarga: r.lugar_descarga ? String(r.lugar_descarga) : null,
      estado: String(r.estado),
      auxiliares,
      paradas,
    });
  }

  // Priorizar coincidencia piloto+placa
  out.sort((a, b) => {
    const score = (p: PlanSalidaMatch) => {
      let s = 0;
      if (
        normPiloto &&
        normalizarNombrePiloto(p.piloto ?? "") === normPiloto
      )
        s += 2;
      if (
        placaAlt &&
        (p.placa ?? "").toUpperCase().replace(/[\s-]/g, "") === placaAlt
      )
        s += 2;
      return s;
    };
    return score(b) - score(a);
  });

  return out;
}

/**
 * OPS-5.2d: acepta transición desde "Programado" O "Cargado" — "Cargado"
 * significa "el vehículo ya fue cargado/preparado, pero TODAVÍA no ha
 * salido" (definición aprobada del negocio), así que la salida real del
 * piloto también debe poder avanzarlo a "En ruta". Antes solo aceptaba
 * "Programado": si Operaciones había marcado el plan como "Cargado" a
 * mano, la salida del piloto no lo movía y quedaba atascado ahí
 * indefinidamente. Deliberadamente NO incluye "Cerrado"/"Cancelado"/
 * "Descargado" — esos estados ya no admiten una nueva salida.
 */
export async function marcarPlanEnRuta(
  empresaId: number,
  planId: number,
): Promise<void> {
  await execute(
    `UPDATE tms_planes_viaje SET estado = 'En ruta'
     WHERE id = ? AND empresa_id = ? AND estado IN ('Programado', 'Cargado')`,
    [planId, empresaId],
  ).catch(() => undefined);
}

/**
 * OPS-1 (corregido): esta función YA NO se invoca automáticamente desde
 * ningún endpoint de llegada (Portal ni Flota) — registrar llegada es
 * solo respaldo operativo, no cambia el estado administrativo del plan.
 * Se conserva solo por compatibilidad histórica (documenta cómo
 * quedaron marcados en "Descargado" los planes del flujo anterior; ver
 * src/lib/tms/cierre-viaje.ts, que sí sabe cerrar esos registros).
 */
export async function marcarPlanDescargado(
  empresaId: number,
  planId: number,
): Promise<void> {
  await execute(
    `UPDATE tms_planes_viaje SET estado = 'Descargado'
     WHERE id = ? AND empresa_id = ?
       AND estado IN ('Programado', 'En ruta')`,
    [planId, empresaId],
  ).catch(() => undefined);
}
