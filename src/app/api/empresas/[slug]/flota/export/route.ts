import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlotaAny } from "@/lib/tenant";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { kmPendienteServicio } from "@/lib/flota/import-excel";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    ["flota_reportes", "flota_vehiculos"],
    "ver",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? "flota"; // flota | servicios | viajes
  const formato = (url.searchParams.get("formato") ?? "xlsx").toLowerCase();
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  let headers: string[] = [];
  let rows: string[][] = [];
  let title = "Flota";
  let filename = "flota";

  if (tipo === "servicios") {
    title = "Servicios de flota";
    filename = "flota-servicios";
    headers = ["Fecha", "Placa", "Tipo", "Km", "Costo", "Descripción"];
    const data = await query<RowDataPacket[]>(
      `SELECT s.fecha_servicio, v.placa, s.tipo, s.km_servicio, s.costo, s.descripcion
       FROM flota_servicios s
       INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
       WHERE s.empresa_id = ?
       ORDER BY s.fecha_servicio DESC
       LIMIT 2000`,
      [guard.empresa.id],
    );
    rows = data
      .filter((r) => !q || String(r.placa).toLowerCase().includes(q))
      .map((r) => [
        String(r.fecha_servicio).slice(0, 10),
        String(r.placa),
        String(r.tipo ?? ""),
        String(r.km_servicio ?? ""),
        Number(r.costo ?? 0).toFixed(2),
        String(r.descripcion ?? ""),
      ]);
  } else if (tipo === "viajes") {
    title = "Viajes de flota";
    filename = "flota-viajes";
    headers = [
      "Salida",
      "Llegada",
      "Placa",
      "Piloto",
      "Km salida",
      "Km llegada",
      "Destino",
      "Estado",
    ];
    const data = await query<RowDataPacket[]>(
      `SELECT v.hora_salida, v.hora_llegada, ve.placa, v.piloto_nombre,
              v.km_salida, v.km_llegada, v.destino, v.estado
       FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.empresa_id = ?
       ORDER BY v.hora_salida DESC
       LIMIT 2000`,
      [guard.empresa.id],
    );
    rows = data
      .filter((r) => !q || String(r.placa).toLowerCase().includes(q))
      .map((r) => [
        String(r.hora_salida ?? "").replace("T", " ").slice(0, 19),
        String(r.hora_llegada ?? "").replace("T", " ").slice(0, 19),
        String(r.placa),
        String(r.piloto_nombre ?? ""),
        String(r.km_salida ?? ""),
        String(r.km_llegada ?? ""),
        String(r.destino ?? ""),
        String(r.estado ?? ""),
      ]);
  } else {
    title = "Inventario de flota";
    filename = "flota-inventario";
    headers = [
      "Placa",
      "Descripción",
      "Marca",
      "Modelo",
      "Km",
      "Intervalo",
      "Pendiente svc",
      "Filtro mayor",
      "Filtro menor",
      "Rin",
      "Medida llanta",
      "Aceite",
      "Empresa",
      "Taller",
      "Estado",
    ];
    let data: RowDataPacket[] = [];
    try {
      data = await query<RowDataPacket[]>(
        `SELECT placa, descripcion, marca, modelo, km_actual, km_intervalo_servicio,
                km_ultimo_servicio, filtro_servicio_mayor, filtro_servicio_menor,
                rin_llanta, medida_llanta, tipo_aceite, empresa_activo, en_taller, estado, activo
         FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
        [guard.empresa.id],
      );
    } catch {
      data = await query<RowDataPacket[]>(
        `SELECT placa, marca, modelo, km_actual, km_intervalo_servicio,
                km_ultimo_servicio, en_taller, estado
         FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
        [guard.empresa.id],
      );
    }
    rows = data
      .filter(
        (r) =>
          !q ||
          String(r.placa).toLowerCase().includes(q) ||
          String(r.marca ?? "")
            .toLowerCase()
            .includes(q),
      )
      .map((r) => {
        const pend = kmPendienteServicio(
          Number(r.km_actual ?? 0),
          r.km_ultimo_servicio == null
            ? null
            : Number(r.km_ultimo_servicio),
          Number(r.km_intervalo_servicio ?? 10000),
        );
        return [
          String(r.placa),
          String(r.descripcion ?? ""),
          String(r.marca ?? ""),
          String(r.modelo ?? ""),
          String(r.km_actual ?? 0),
          String(r.km_intervalo_servicio ?? ""),
          pend == null ? "" : String(pend),
          String(r.filtro_servicio_mayor ?? ""),
          String(r.filtro_servicio_menor ?? ""),
          String(r.rin_llanta ?? ""),
          String(r.medida_llanta ?? ""),
          String(r.tipo_aceite ?? ""),
          String(r.empresa_activo ?? ""),
          Number(r.en_taller) ? "Sí" : "No",
          String(r.estado ?? ""),
        ];
      });
  }

  const subtitle = `${guard.empresa.nombre} · ${new Date().toLocaleString("es-GT")}`;

  if (formato === "pdf") {
    const buf = await tablaAPdf({ title, subtitle, headers, rows });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}.pdf"`,
      },
    });
  }

  const buf = await tablaAExcel({
    sheetName: title.slice(0, 31),
    headers,
    rows,
  });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}
