import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";
import { parseAnio, tipoDocumentoComprobanteCumpleanios } from "@/lib/rrhh/cumpleanios-shared";
import { empleadoDeEmpresa, listarDocumentosPorTipo, subirDocumentoPorTipo } from "@/lib/rrhh/documentos-por-tipo";

type Ctx = { params: Promise<{ slug: string }> };

const resumen = (d: { id: number; nombreOriginal: string | null; subidoEn: string; subidoPor: string | null }) => ({
  id: d.id,
  nombre: d.nombreOriginal,
  subidoEn: d.subidoEn,
  subidoPor: d.subidoPor,
});

/**
 * RRHH → Cumpleaños por mes — comprobantes de la tarjeta/vale de cumpleaños. La evidencia pertenece a
 * empresa + empleado + AÑO del cumpleaños (un empleado puede tener comprobantes de varios años, independientes).
 *
 * Reutiliza el sistema de documentos del empleado (`documentos_empleados` + storage privado de `@/lib/uploads`); el año va en el
 * tipo de documento («Comprobante de cumpleaños 2026»). Sin tabla ni storage nuevos. La descarga es por endpoint protegido.
 *
 * GET  ?empleadoId=&anio=            → lista (permiso de lectura de Reportes de RRHH).
 * POST multipart empleadoId,anio,file → adjunta (permiso `empleados:editar`, igual que los documentos del expediente).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "reportes", "ver");
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const empleadoId = Number(url.searchParams.get("empleadoId"));
  const anio = parseAnio(url.searchParams.get("anio"));
  if (!Number.isInteger(empleadoId) || empleadoId <= 0 || anio == null) {
    return NextResponse.json({ error: "Empleado o año inválidos." }, { status: 400 });
  }
  try {
    const emp = await empleadoDeEmpresa(guard.empresa.id, empleadoId);
    if (!emp) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    const docs = await listarDocumentosPorTipo(guard.empresa.id, empleadoId, tipoDocumentoComprobanteCumpleanios(anio));
    return NextResponse.json(
      { empleado: emp, anio, comprobantes: docs.map(resumen) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) guard = await requireTenantRrhh(slug, "empleados", "crear");
  if (guard.error) return guard.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo recibir el archivo completo. Intenta nuevamente con un archivo más pequeño." }, { status: 400 });
  }
  const empleadoId = Number(form.get("empleadoId"));
  const anio = parseAnio(String(form.get("anio") ?? ""));
  const file = form.get("file") as File | null;
  if (!Number.isInteger(empleadoId) || empleadoId <= 0 || anio == null) {
    return NextResponse.json({ error: "Empleado o año inválidos." }, { status: 400 });
  }
  if (!file || typeof file.arrayBuffer !== "function") return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });

  try {
    const emp = await empleadoDeEmpresa(guard.empresa.id, empleadoId);
    if (!emp) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    const doc = await subirDocumentoPorTipo({
      empresaId: guard.empresa.id,
      empleadoId,
      tipoDocumento: tipoDocumentoComprobanteCumpleanios(anio),
      prefijo: `cumple_${empleadoId}_${anio}`,
      usuario: guard.session.username,
      file,
      accionAuditoria: "comprobante_cumpleanios_adjuntado",
      detalleAuditoria: `Comprobante de cumpleaños ${anio} · empleado #${empleadoId} (${emp.codigo})`,
    });
    return NextResponse.json({ mensaje: "Comprobante adjuntado.", comprobante: resumen(doc) }, { status: 201 });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
