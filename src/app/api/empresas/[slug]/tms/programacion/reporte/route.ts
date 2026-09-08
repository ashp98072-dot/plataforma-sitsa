import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { listarParadasDePlanes } from "@/lib/tms/paradas";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";

type Ctx = { params: Promise<{ slug: string }> };

// VIAT-4b: abreviatura de 3 letras, confirmado contra el Excel real
// (Libro1.xlsx / hoja PROGRAMACIÓN usa "AGO", no "Agosto").
const MESES = [
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SEP", "OCT", "NOV", "DIC",
];

type AuxiliarOrdenado = { plan_id: number; nombre: string; orden: number };

/**
 * VIAT-4/VIAT-4b (puntos 8-10) — reporte TRADICIONAL de Programación, en
 * el orden EXACTO del Excel operativo actual: Mes, Día, Placa, Piloto,
 * Auxiliar 1, Auxiliar 2, Código, Cliente, Lugar de Carga, Hora, Lugar de
 * Descarga. A propósito NO incluye tarifa comercial, viáticos, datos
 * bancarios, contactos internos ni estados técnicos — este es el reporte
 * "tradicional"; una versión ampliada, si Operaciones la pide después, es
 * un endpoint/columnas aparte, no se mezcla aquí.
 *
 * "Código" sale de ruta_codigo_historico (fotografía histórica de la
 * ruta usada, no el código interno del viaje). Si el viaje no usó una
 * ruta del catálogo, la celda queda vacía (no se inventa un código).
 *
 * "Lugar de Descarga" sale de lugar_descarga_historico (VIAT-4b —
 * corrección tras revisar el Excel real: la columna H de "CODIGOS DATA"
 * es una descripción operativa completa de texto libre (formato tipo
 * "RUTA-X - punto1-punto2-punto3"), NO una lista de paradas). NUNCA se toma de
 * "primera parada" — las paradas estructuradas (tms_plan_paradas) siguen
 * existiendo intactas para seguimiento operativo/evidencia, pero esta
 * columna no depende de ellas.
 *
 * "Lugar de Carga" sí sigue viniendo de la parada tipo Carga
 * (tms_plan_paradas, texto congelado en el momento de guardar el viaje,
 * no un JOIN en vivo) — no tenía el mismo problema que Descarga.
 *
 * PROGRAMACION-REPORTES-FILTROS-1 — corrección: antes este endpoint SOLO
 * aceptaba fecha/fechaDesde/fechaHasta, así que el Excel/PDF "traicionaba"
 * cualquier otro filtro activo en el tablero de Programación (Estado,
 * Piloto, Unidad, Cliente) — programacion-client.tsx solo enviaba las
 * fechas del propio widget de reporte. Ahora acepta también estado/
 * piloto/unidad/cliente, con EXACTAMENTE el mismo criterio que
 * programacion-client.tsx usa para calcular `visibles` (el tablero) —
 * mismos nombres de filtro rápido, mismo match exacto por nombre/placa —
 * para que el archivo exportado sea siempre el mismo conjunto de viajes
 * que el usuario tiene filtrado en pantalla. "PendienteCierre" replica el
 * mismo criterio SQL que tms/planes?pendienteCierre=1 y
 * src/lib/tms/reportes-viajes.ts (SQL_PENDIENTE_CIERRE) — y, como en
 * ambos, ignora el rango de fechas a propósito (un pendiente antiguo
 * nunca debe desaparecer del reporte por quedar fuera del rango elegido).
 */
const ESTADOS_FILTRO_VALIDOS = new Set([
  "Programado",
  "En ruta",
  "Cerrado",
  "PendienteCierre",
  "sin_piloto",
  "sin_unidad",
  "sin_auxiliares",
]);

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") === "pdf" ? "pdf" : "xlsx";
  const fechaExacta = url.searchParams.get("fecha") || undefined;
  const fechaDesde = fechaExacta || url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = fechaExacta || url.searchParams.get("fechaHasta") || undefined;

  const estadoRaw = url.searchParams.get("estado") || undefined;
  const estado = estadoRaw && ESTADOS_FILTRO_VALIDOS.has(estadoRaw) ? estadoRaw : undefined;
  const piloto = url.searchParams.get("piloto")?.trim() || undefined;
  const unidad = url.searchParams.get("unidad")?.trim() || undefined;
  const cliente = url.searchParams.get("cliente")?.trim() || undefined;

  // "PendienteCierre" ignora el rango de fechas a propósito (mismo
  // criterio que soloPendientesCierre en reportes-viajes.ts) — en
  // cualquier otro caso, sigue siendo obligatorio indicar fecha o rango.
  if (estado !== "PendienteCierre" && (!fechaDesde || !fechaHasta)) {
    return NextResponse.json(
      { error: "Indica una fecha específica o un rango (fechaDesde/fechaHasta)." },
      { status: 400 },
    );
  }

  const condiciones = ["p.empresa_id = ?"];
  const params: (string | number)[] = [guard.empresa.id];
  if (estado === "PendienteCierre") {
    condiciones.push(
      `(p.estado NOT IN ('Cerrado', 'Cancelado') AND EXISTS (
         SELECT 1 FROM flota_viajes fv
         WHERE fv.plan_id = p.id AND fv.empresa_id = p.empresa_id AND fv.estado = 'cerrado'
       ))`,
    );
  } else if (fechaDesde && fechaHasta) {
    condiciones.push("p.fecha_plan BETWEEN ? AND ?");
    params.push(fechaDesde, fechaHasta);
  }
  if (estado === "Programado" || estado === "En ruta" || estado === "Cerrado") {
    condiciones.push("p.estado = ?");
    params.push(estado);
  } else if (estado === "sin_piloto") {
    condiciones.push("p.piloto_id IS NULL");
  } else if (estado === "sin_unidad") {
    condiciones.push("p.unidad_id IS NULL");
  } else if (estado === "sin_auxiliares") {
    condiciones.push("NOT EXISTS (SELECT 1 FROM tms_plan_auxiliares pa WHERE pa.plan_id = p.id)");
  }
  if (piloto) {
    condiciones.push("pil.nombre = ?");
    params.push(piloto);
  }
  if (unidad) {
    condiciones.push("u.placa = ?");
    params.push(unidad);
  }
  if (cliente) {
    condiciones.push("c.nombre = ?");
    params.push(cliente);
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, DATE_FORMAT(p.fecha_plan, '%Y-%m-%d') AS fecha_plan,
            p.hora_carga, p.ruta_codigo_historico, p.lugar_descarga_historico,
            c.nombre AS cliente, u.placa, pil.nombre AS piloto
     FROM tms_planes_viaje p
     LEFT JOIN tms_clientes c ON c.id = p.cliente_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY p.fecha_plan, p.hora_carga, p.id`,
    params,
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
    // VIAT-4b: NUNCA "primera parada" — siempre el histórico congelado del viaje.
    const lugarDescarga = r.lugar_descarga_historico ? String(r.lugar_descarga_historico) : "";
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

  const rango =
    estado === "PendienteCierre"
      ? "Pendientes de cierre (todas las fechas)"
      : fechaDesde === fechaHasta
        ? fechaDesde
        : `${fechaDesde} a ${fechaHasta}`;
  const filtrosAplicados = [
    estado ? `Estado: ${estado === "PendienteCierre" ? "Pendiente de cierre" : estado}` : null,
    piloto ? `Piloto: ${piloto}` : null,
    unidad ? `Unidad: ${unidad}` : null,
    cliente ? `Cliente: ${cliente}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const fecha = new Date().toISOString().slice(0, 10);

  if (formato === "pdf") {
    const buf = await tablaAPdf({
      title: "PROGRAMACIÓN",
      subtitle: `${guard.empresa.nombre} · ${rango}${filtrosAplicados ? ` · ${filtrosAplicados}` : ""} · Generado ${new Date().toLocaleString("es-GT")}`,
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
