import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { normalizarNombrePiloto } from "@/lib/flota/pilotos";

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
       AND p.estado IN ('Programado', 'En ruta')
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

export async function marcarPlanEnRuta(
  empresaId: number,
  planId: number,
): Promise<void> {
  await execute(
    `UPDATE tms_planes_viaje SET estado = 'En ruta'
     WHERE id = ? AND empresa_id = ? AND estado = 'Programado'`,
    [planId, empresaId],
  ).catch(() => undefined);
}

/** Al cerrar llegada en flota: plan → Descargado (luego Ops puede cerrarlo). */
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
