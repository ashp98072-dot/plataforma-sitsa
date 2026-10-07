import { NextResponse } from "next/server";
import { requireTenantViaticosComprobantes, requireTenantViaticosAny } from "@/lib/tenant";
import { permisosEfectivos, tienePermiso } from "@/lib/permisos";
import type { RolGlobal } from "@/lib/roles";
import { filtrosReporteSchema, mensajeSinDatos } from "@/lib/tms/viaticos-reporte-filtros";
import { datosReporteViaticos, reporteViaticosExcel, reporteViaticosPdf } from "@/lib/tms/viaticos-reporte";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViaticosComprobantes(slug, "ver");
  if (guard.error) return guard.error;
  // Exportar no sustituye el acceso al listado; mismos permisos existentes, sin concesiones nuevas.
  const lectura = await requireTenantViaticosAny(slug, "ver");
  if (lectura.error) return lectura.error;
  const sp = new URL(req.url).searchParams;
  const formato = sp.get("formato");
  const parsed = filtrosReporteSchema.safeParse(Object.fromEntries(sp));
  if (!parsed.success || !["pdf", "excel"].includes(formato ?? "")) {
    return NextResponse.json({ error: "Estado, formato o filtros inválidos." }, { status: 400 });
  }
  const f = parsed.data;
  const perms = await permisosEfectivos(guard.session.id, guard.session.rol as RolGlobal);
  const bancario = tienePermiso(perms, "viaticos_pagar", "ver");
  const items = await datosReporteViaticos(guard.empresa.id, f, bancario);
  if (!items.length) return NextResponse.json({ error: mensajeSinDatos(f.estado) }, { status: 404 });
  const pdf = formato === "pdf";
  const buffer = await (pdf ? reporteViaticosPdf : reporteViaticosExcel)(items, guard.empresa.nombre, f, bancario);
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Content-Type": pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="viaticos-${f.estado.toLowerCase()}.${pdf ? "pdf" : "xlsx"}"`,
    "Cache-Control": "private, no-store",
  } });
}
