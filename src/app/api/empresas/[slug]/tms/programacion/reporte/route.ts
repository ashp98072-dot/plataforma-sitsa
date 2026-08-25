import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { listarParadasDePlanes } from "@/lib/tms/paradas";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";

type Ctx = { params: Promise<{ slug: string }> };

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

type AuxiliarOrdenado = { plan_id: number; nombre: string; orden: number };

/**
 * VIAT-4 (puntos 8-10) — reporte TRADICIONAL de Programación, en el orden
 * EXACTO del Excel operativo actual: Mes, Día, Placa, Piloto, Auxiliar 1,
 * Auxiliar 2, Código, Cliente, Lugar de Carga, Hora, Lugar de Descarga.
 * A propósito NO incluye tarifa comercial, viáticos, datos bancarios,
 * contactos internos ni estados técnicos — este es el reporte
 * "tradicional"; una versión ampliada, si Operaciones la pide después, es
 * un endpoint/():columnas aparte, no se mezcla aquí.
 *
 * "Código" sale de ruta_codigo_historico (VIAT-4: fotografía histórica de
 * la ruta usada, no el código interno del viaje — ver
 * tms_planes_viaje.codigo vs. ruta_codigo_historico). Si el viaje no usó
 * una ruta del catálogo, la celda queda vacía (no se inventa un código).
 *
 * "Lugar de Descarga": si el viaje tiene varios destinos (paradas tipo
 * Entrega/Descarga), este reporte tradicional muestra solo el PRIMERO —
 * sin haber podido revisar el Excel real en esta fase para confirmar
 * cómo se representan múltiples destinos ahí, se prefirió no concatenar
 * de forma potencialmente ilegible. El sistema conserva TODOS los
 * destinos igual (tms_plan_paradas) — no se pierde información interna,
 * solo no se listan todos en esta columna tradicional.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") === "pdf" ? "pdf" : "xlsx";
  const fechaExacta = url.searchParams.get("fecha") || undefined;
  const fechaDesde = fechaExacta || url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = fechaExacta || url.searchParams.get("fechaHasta") || undefined;

  if (!fechaDesde || !fechaHasta) {
    return NextResponse.json(
      { error: "Indica una fecha específica o un rango (fechaDesde/fechaHasta)." },
      { status: 400 },
    );
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
            p.hora_carga, p.ruta_codigo_historico,
            c.nombre AS cliente, u.placa, pil.nombre AS piloto
     FROM tms_planes_viaje p
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     WHERE p.empresa_id = ? AND p.fecha_plan BETWEEN ? AND ?
     ORDER BY p.fecha_plan, p.hora_carga, p.id`,
    [guard.empresa.id, fechaDesde, fechaHasta],
  );

  const planIds = rows.map((r) => Number(r.id));
  const [paradasMap, auxRows] = await Promise.all([
    listarParadasDePlanes(planIds),
    planIds.length
      ? query<RowDataPacket[]>(
          `SELECT a.plan_id, per.nombre, a.orden
           FROM tms_plan_auxiliares a
           INNER JOIN tms_personal per ON per.id = a.personal_id
           WHERE a.plan_id IN (${planIds.map(() => "?").join(",")})
           ORDER BY a.plan_id, a.orden, a.id`,
          planIds,
        ).catch(() => [] as RowDataPacket[])
      : Promise.resolve([] as RowDataPacket[]),
  ]);

  const auxPorPlan = new Map<number, AuxiliarOrdenado[]>();
  for (const r of auxRows) {
    const pid = Number(r.plan_id);
    const list = auxPorPlan.get(pid) ?? [];
    list.push({ plan_id: pid, nombre: String(r.nombre), orden: Number(r.orden) });
    auxPorPlan.set(pid, list);
  }

  const headers = [
    "Mes", "Día", "Placa", "Piloto", "Auxiliar 1", "Auxiliar 2",
    "Código", "Cliente", "Lugar de Carga", "Hora", "Lugar de Descarga",
  ];

  const dataRows = rows.map((r) => {
    const id = Number(r.id);
    const [anio, mes, dia] = String(r.fecha_plan).split("-").map(Number);
    void anio;
    const paradas = paradasMap.get(id) ?? [];
    const lugarCarga = paradas.find((p) => p.tipo === "Carga")?.lugar_nombre ?? "";
    const lugarDescarga = paradas.find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")?.lugar_nombre ?? "";
    const auxiliares = auxPorPlan.get(id) ?? [];
    const hora = r.hora_carga ? String(r.hora_carga).slice(0, 5) : "";
    return [
      MESES[(mes ?? 1) - 1] ?? "",
      String(dia ?? ""),
      r.placa ? String(r.placa) : "",
      r.piloto ? String(r.piloto) : "",
      auxiliares[0]?.nombre ?? "",
      auxiliares[1]?.nombre ?? "",
      r.ruta_codigo_historico ? String(r.ruta_codigo_historico) : "",
      r.cliente ? String(r.cliente) : "",
      lugarCarga,
      hora,
      lugarDescarga,
    ];
  });

  const rango = fechaDesde === fechaHasta ? fechaDesde : `${fechaDesde} a ${fechaHasta}`;
  const fecha = new Date().toISOString().slice(0, 10);

  if (formato === "pdf") {
    const buf = await tablaAPdf({
      title: "PROGRAMACIÓN",
      subtitle: `${guard.empresa.nombre} · ${rango} · Generado ${new Date().toLocaleString("es-GT")}`,
      headers,
      rows: dataRows,
      layout: "landscape",
      modo: "tabla",
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="programacion-${fecha}.pdf"`,
      },
    });
  }

  const buf = await tablaAExcel({ sheetName: "Programacion", headers, rows: dataRows });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="programacion-${fecha}.xlsx"`,
    },
  });
}
