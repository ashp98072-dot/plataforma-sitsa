import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlotaAny } from "@/lib/tenant";
import { celdaPdf, tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import {
  generarPlantillaFlota,
  kmPendienteServicio,
} from "@/lib/flota/import-excel";
import {
  formatearFiltrosCorto,
  listarFiltrosPorVehiculos,
} from "@/lib/flota/filtros";

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
    await asegurarSchemaFlotaLectura();
  } catch {
    /* ok */
  }

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? "flota"; // flota | servicios | viajes
  const formato = (url.searchParams.get("formato") ?? "xlsx").toLowerCase();
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  if (tipo === "flota" && formato === "plantilla") {
    const buf = await generarPlantillaFlota();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="plantilla_flota_vehiculos.xlsx"',
      },
    });
  }

  let headers: string[] = [];
  let rows: string[][] = [];
  let title = "Flota";
  let filename = "flota";

  if (tipo === "servicios") {
    title = "Servicios de flota";
    filename = "flota-servicios";
    headers = [
      "Entra taller",
      "Sale taller",
      "Días",
      "Placa",
      "Tipo",
      "Km",
      "Costo",
      "Repuestos",
      "Observaciones",
    ];
    const data = await query<RowDataPacket[]>(
      `SELECT s.fecha_servicio, s.fecha_entrada_taller, s.fecha_salida_taller,
              s.dias_en_taller, v.placa, s.tipo, s.km_servicio, s.costo,
              s.descripcion, s.repuestos, s.observaciones
       FROM flota_servicios s
       INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
       WHERE s.empresa_id = ?
       ORDER BY s.fecha_servicio DESC
       LIMIT 2000`,
      [guard.empresa.id],
    ).catch(async () =>
      query<RowDataPacket[]>(
        `SELECT s.fecha_servicio, v.placa, s.tipo, s.km_servicio, s.costo, s.descripcion
         FROM flota_servicios s
         INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
         WHERE s.empresa_id = ?
         ORDER BY s.fecha_servicio DESC
         LIMIT 2000`,
        [guard.empresa.id],
      ),
    );
    rows = data
      .filter((r) => !q || String(r.placa).toLowerCase().includes(q))
      .map((r) => [
        r.fecha_entrada_taller
          ? String(r.fecha_entrada_taller).slice(0, 10)
          : "",
        r.fecha_salida_taller
          ? String(r.fecha_salida_taller).slice(0, 10)
          : String(r.fecha_servicio).slice(0, 10),
        r.dias_en_taller != null ? String(r.dias_en_taller) : "",
        String(r.placa),
        String(r.tipo ?? ""),
        String(r.km_servicio ?? ""),
        Number(r.costo ?? 0).toFixed(2),
        String(r.descripcion ?? r.repuestos ?? ""),
        String(r.observaciones ?? ""),
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
      "Km recorridos",
      "Destino",
      "Observaciones",
      "Estado",
      "Plan TMS",
      "Estado plan",
      "Evidencias",
      "Externo",
    ];
    const data = await query<RowDataPacket[]>(
      `SELECT v.hora_salida, v.hora_llegada, ve.placa, v.piloto_nombre,
              v.km_salida, v.km_llegada, v.destino, v.observaciones, v.estado,
              v.es_externo, p.codigo AS plan_codigo, p.estado AS plan_estado,
              (SELECT COUNT(*) FROM flota_viaje_evidencias ev
               WHERE ev.viaje_id = v.id AND ev.empresa_id = v.empresa_id) AS evidencias
       FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       LEFT JOIN tms_planes_viaje p ON p.id = v.plan_id
       WHERE v.empresa_id = ?
       ORDER BY v.hora_salida DESC
       LIMIT 2000`,
      [guard.empresa.id],
    ).catch(async () =>
      query<RowDataPacket[]>(
        `SELECT v.hora_salida, v.hora_llegada, ve.placa, v.piloto_nombre,
                v.km_salida, v.km_llegada, v.destino, v.estado
         FROM flota_viajes v
         INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
         WHERE v.empresa_id = ?
         ORDER BY v.hora_salida DESC
         LIMIT 2000`,
        [guard.empresa.id],
      ),
    );
    rows = data
      .filter((r) => !q || String(r.placa).toLowerCase().includes(q))
      .map((r) => {
        const kmS = Number(r.km_salida ?? 0);
        const kmL = r.km_llegada != null ? Number(r.km_llegada) : null;
        return [
          celdaPdf(r.hora_salida),
          celdaPdf(r.hora_llegada),
          String(r.placa),
          String(r.piloto_nombre ?? ""),
          kmS.toLocaleString("es-GT"),
          kmL != null ? kmL.toLocaleString("es-GT") : "",
          kmL != null ? (kmL - kmS).toLocaleString("es-GT") : "",
          String(r.destino ?? ""),
          String(r.observaciones ?? ""),
          String(r.estado ?? ""),
          String(r.plan_codigo ?? ""),
          String(r.plan_estado ?? ""),
          String(r.evidencias ?? 0),
          Number(r.es_externo) ? "Sí" : "No",
        ];
      });
  } else {
    title = "Inventario de flota";
    filename = "flota-inventario";
    // PDF: columnas compactas y legibles. Excel: detalle completo abajo.
    const headersPdf = [
      "Placa",
      "Descripción",
      "Marca",
      "Modelo",
      "Km",
      "Int.",
      "Pend.",
      "Filtros",
      "Rin",
      "Llanta",
      "Aceite",
      "Emp.",
      "Taller",
      "Estado",
    ];
    headers = [
      "placa",
      "descripcion",
      "marca",
      "modelo",
      "color",
      "km_actual",
      "km_intervalo",
      "km_ultimo_servicio",
      "pendiente_svc",
      "filtros",
      "rin_llanta",
      "medida_llanta",
      "tipo_aceite",
      "tipo_combustible",
      "chasis",
      "capacidad",
      "empresa",
      "nit",
      "credito",
      "seguros",
      "condicion_propiedad",
      "taller",
      "activo",
      "estado",
      "notas",
    ];
    let data: RowDataPacket[] = [];
    try {
      data = await query<RowDataPacket[]>(
        `SELECT id, placa, descripcion, marca, modelo, color, km_actual, km_intervalo_servicio,
                km_ultimo_servicio, filtro_servicio_mayor, filtro_servicio_menor,
                rin_llanta, medida_llanta, tipo_aceite, tipo_combustible, chasis, capacidad,
                empresa_activo, nit, credito, seguros, condicion_propiedad, notas,
                en_taller, estado, activo
         FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
        [guard.empresa.id],
      );
    } catch {
      data = await query<RowDataPacket[]>(
        `SELECT id, placa, marca, modelo, km_actual, km_intervalo_servicio,
                km_ultimo_servicio, en_taller, estado
         FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
        [guard.empresa.id],
      );
    }
    const filtrosMap = await listarFiltrosPorVehiculos(
      data.map((r) => Number(r.id)),
    );
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
        const listaFiltros = filtrosMap.get(Number(r.id)) ?? [];
        let filtrosTxt = listaFiltros
          .map((f) => `${f.tipo}:${f.codigo}`)
          .join(" | ");
        if (!filtrosTxt) {
          filtrosTxt = [
            r.filtro_servicio_mayor
              ? `Servicio mayor:${r.filtro_servicio_mayor}`
              : "",
            r.filtro_servicio_menor
              ? `Servicio menor:${r.filtro_servicio_menor}`
              : "",
          ]
            .filter(Boolean)
            .join(" | ");
        }
        if (formato === "pdf") {
          return [
            String(r.placa),
            String(r.descripcion ?? ""),
            String(r.marca ?? ""),
            String(r.modelo ?? ""),
            Number(r.km_actual ?? 0).toLocaleString("es-GT"),
            String(r.km_intervalo_servicio ?? ""),
            pend == null ? "" : Number(pend).toLocaleString("es-GT"),
            formatearFiltrosCorto(listaFiltros),
            String(r.rin_llanta ?? ""),
            String(r.medida_llanta ?? ""),
            String(r.tipo_aceite ?? ""),
            String(r.empresa_activo ?? ""),
            Number(r.en_taller) ? "Sí" : "No",
            String(r.estado ?? ""),
          ];
        }
        return [
          String(r.placa),
          String(r.descripcion ?? ""),
          String(r.marca ?? ""),
          String(r.modelo ?? ""),
          String(r.color ?? ""),
          String(r.km_actual ?? ""),
          String(r.km_intervalo_servicio ?? ""),
          String(r.km_ultimo_servicio ?? ""),
          pend == null ? "" : String(pend),
          filtrosTxt,
          String(r.rin_llanta ?? ""),
          String(r.medida_llanta ?? ""),
          String(r.tipo_aceite ?? ""),
          String(r.tipo_combustible ?? ""),
          String(r.chasis ?? ""),
          String(r.capacidad ?? ""),
          String(r.empresa_activo ?? ""),
          String(r.nit ?? ""),
          String(r.credito ?? ""),
          String(r.seguros ?? ""),
          String(r.condicion_propiedad ?? ""),
          Number(r.en_taller) ? "Sí" : "No",
          Number(r.activo ?? 1) ? "1" : "0",
          String(r.estado ?? ""),
          String(r.notas ?? ""),
        ];
      });
    // headersPdf se usa solo en PDF (mismo orden de columnas)
    if (formato === "pdf") {
      headers = headersPdf;
    }
  }

  const subtitle = `${guard.empresa.nombre} · ${new Date().toLocaleString("es-GT")}`;

  if (formato === "pdf") {
    const buf = await tablaAPdf({
      title,
      subtitle,
      headers,
      rows,
      // Viajes / inventario: fichas legibles. Servicios (pocas cols): tabla.
      modo: headers.length > 7 ? "fichas" : "auto",
      layout: "auto",
    });
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
