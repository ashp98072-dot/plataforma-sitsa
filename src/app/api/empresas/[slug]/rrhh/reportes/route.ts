import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import ExcelJS from "exceljs";
import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const desde =
    url.searchParams.get("desde") ?? new Date().toISOString().slice(0, 10);
  const hasta = url.searchParams.get("hasta") ?? desde;
  const formato = url.searchParams.get("formato") ?? "json";

  const rows = await query<RowDataPacket[]>(
    `SELECT e.codigo, e.nombre, s.fecha_jornada, s.entrada_at, s.salida_at, s.estado
     FROM sesiones_trabajo s
     INNER JOIN empleados e ON e.id = s.id_empleado
     WHERE s.empresa_id = ? AND s.fecha_jornada BETWEEN ? AND ?
     ORDER BY s.fecha_jornada, e.nombre`,
    [guard.empresa.id, desde, hasta],
  );

  if (formato === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Asistencias");
    ws.addRow([
      "Código",
      "Empleado",
      "Fecha",
      "Entrada",
      "Salida",
      "Estado",
    ]);
    for (const r of rows) {
      ws.addRow([
        r.codigo,
        r.nombre,
        String(r.fecha_jornada).slice(0, 10),
        r.entrada_at ? String(r.entrada_at) : "",
        r.salida_at ? String(r.salida_at) : "",
        r.estado ?? "",
      ]);
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="asistencias-${slug}-${desde}-${hasta}.xlsx"`,
      },
    });
  }

  return NextResponse.json({
    desde,
    hasta,
    empresa: guard.empresa.nombre,
    filas: rows,
  });
}
