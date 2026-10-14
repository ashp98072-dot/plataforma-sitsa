import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { hoyLocal } from "@/lib/rrhh/dates";
import {
  ENCABEZADOS_CUMPLEANIOS,
  filasExcelCumpleanios,
  listarCumpleaniosDelMes,
  nombreArchivoCumpleanios,
  nombreMes,
  parseAnio,
  parseMes,
} from "@/lib/rrhh/cumpleanios";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * RRHH — listado de cumpleaños por mes (consulta y exportación Excel). Permiso de lectura de Reportes de RRHH
 * (`reportes:ver`), igual que el resto de reportes. La empresa sale SIEMPRE del tenant/sesión; el cliente solo elige
 * mes, año, si incluye bajas y el formato. Solo lectura; no expone DPI, NIT, IGSS, dirección ni teléfono.
 *
 * GET ?mes=1..12 (defecto: mes actual) &anio=YYYY (defecto: año actual) &incluirInactivos=1 &formato=json|xlsx
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "reportes", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const hoy = hoyLocal();
  const mesParam = url.searchParams.get("mes");
  const anioParam = url.searchParams.get("anio");
  const mes = mesParam === null || mesParam === "" ? Number(hoy.slice(5, 7)) : parseMes(mesParam);
  const anio = anioParam === null || anioParam === "" ? Number(hoy.slice(0, 4)) : parseAnio(anioParam);
  if (mes == null) return NextResponse.json({ error: "Mes inválido (1 a 12)." }, { status: 400 });
  if (anio == null) return NextResponse.json({ error: "Año inválido." }, { status: 400 });
  const incluirInactivos = url.searchParams.get("incluirInactivos") === "1";
  const formato = url.searchParams.get("formato") ?? "json";
  if (formato !== "json" && formato !== "xlsx") return NextResponse.json({ error: "Formato inválido." }, { status: 400 });

  let listado;
  try {
    listado = await listarCumpleaniosDelMes(guard.empresa.id, mes, anio, { incluirInactivos });
  } catch (error) {
    console.error("[rrhh-cumpleanios] Consulta no disponible", error);
    return NextResponse.json({ error: "No se pudo cargar el listado de cumpleaños." }, { status: 500 });
  }

  if (formato === "xlsx") {
    const { tablaAExcel } = await import("@/lib/rrhh/export-files");
    const buf = await tablaAExcel({
      sheetName: `Cumpleaños ${nombreMes(mes)}`,
      headers: [...ENCABEZADOS_CUMPLEANIOS],
      rows: filasExcelCumpleanios(listado.empleados),
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombreArchivoCumpleanios(mes, anio)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return NextResponse.json({ ...listado, empresa: guard.empresa.nombre }, { headers: { "Cache-Control": "private, no-store" } });
}
