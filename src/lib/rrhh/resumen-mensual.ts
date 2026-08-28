import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

export function rangoMes(mes: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes) || Number(mes.slice(0, 4)) < 2000) throw new Error("Mes inválido");
  const [y, m] = mes.split("-").map(Number);
  return [mes + "-01", `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`];
}

/** Solo lectura, identidad del portal. No sumar detalles que ya integran la línea. */
export async function resumenMensualPropio(empresaId: number, empleadoId: number, mes: string) {
  const [desde, hasta] = rangoMes(mes);
  const nomina = await query<RowDataPacket[]>(
    `SELECT p.id AS periodo_id, p.codigo, l.sueldo_base, l.bono_incentivo,
      l.bono_herramientas, l.otros_ingresos, l.descuentos, l.igss_laboral, l.isr, l.neto, l.estado_pago
     FROM rrhh_planilla_lineas l
     INNER JOIN rrhh_planilla_periodos p ON p.id = l.periodo_id AND p.empresa_id = l.empresa_id
     WHERE l.empresa_id = ? AND l.id_empleado = ? AND p.estado IN ('Cerrada', 'Pagada')
       AND p.fecha_inicio >= ? AND p.fecha_inicio < ? ORDER BY p.fecha_inicio, p.id`,
    [empresaId, empleadoId, desde, hasta],
  );
  // La consulta de viáticos es independiente: su fallo nunca convierte el saldo en cero.
  let viaticos: { estado: string; monto: number }[] | null = null;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT v.estado, SUM(v.monto_asignado) AS monto
       FROM tms_viaticos v
       INNER JOIN tms_personal tp ON tp.id = v.personal_id AND tp.empresa_id = v.empresa_id
       INNER JOIN tms_planes_viaje p ON p.id = v.plan_id AND p.empresa_id = v.empresa_id
       WHERE v.empresa_id = ? AND tp.id_empleado = ? AND tp.tipo IN ('Piloto', 'Auxiliar')
         AND p.fecha_plan >= ? AND p.fecha_plan < ? GROUP BY v.estado`,
      [empresaId, empleadoId, desde, hasta],
    );
    viaticos = rows.map((r) => ({ estado: String(r.estado), monto: Number(r.monto) }));
  } catch { /* mostrar no disponible, nunca inventar entrega */ }
  return {
    nomina: nomina.map((r) => ({
      periodoId: Number(r.periodo_id), codigo: String(r.codigo), estado: String(r.estado_pago),
      salario: Number(r.sueldo_base), incentivo: Number(r.bono_incentivo),
      herramientas: Number(r.bono_herramientas), adicionales: Number(r.otros_ingresos),
      descuentos: Number(r.descuentos), igss: Number(r.igss_laboral), isr: Number(r.isr), neto: Number(r.neto),
    })), viaticos,
  };
}
