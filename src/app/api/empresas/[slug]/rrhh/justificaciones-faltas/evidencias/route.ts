import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import { requireTenantRrhh } from "@/lib/tenant";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";
import { fechaCalendarioValida, tipoDocumentoEvidenciaJustificacion } from "@/lib/rrhh/justificaciones-faltas-shared";
import { empleadoDeEmpresa, subirDocumentoPorTipo } from "@/lib/rrhh/documentos-por-tipo";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Adjunta evidencia (JPG/JPEG/PNG/WebP/PDF, privada) a la justificación ACTIVA de un empleado en una fecha. Reutiliza el sistema de
 * documentos del empleado (`documentos_empleados` + storage de `@/lib/uploads`); el tipo del documento identifica la fecha.
 * Permiso `incidencias:crear` o `incidencias:editar`. La empresa sale de la sesión; el empleado debe ser de esa empresa.
 *
 * multipart: empleadoId, fecha (YYYY-MM-DD), file
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let guard = await requireTenantRrhh(slug, "incidencias", "editar");
  if (guard.error) guard = await requireTenantRrhh(slug, "incidencias", "crear");
  if (guard.error) return guard.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo recibir el archivo completo. Intenta nuevamente con un archivo más pequeño." }, { status: 400 });
  }
  const empleadoId = Number(form.get("empleadoId"));
  const fecha = String(form.get("fecha") ?? "");
  const file = form.get("file") as File | null;
  if (!Number.isInteger(empleadoId) || empleadoId <= 0 || !fechaCalendarioValida(fecha)) {
    return NextResponse.json({ error: "Empleado o fecha inválidos." }, { status: 400 });
  }
  if (!file || typeof file.arrayBuffer !== "function") return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });

  try {
    const empresaId = guard.empresa.id;
    const emp = await empleadoDeEmpresa(empresaId, empleadoId);
    if (!emp) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    const activa = await query<RowDataPacket[]>(
      "SELECT id FROM rrhh_asistencia_justificaciones WHERE empresa_id = ? AND empleado_id = ? AND fecha = ? AND estado = 'ACTIVA' LIMIT 1",
      [empresaId, empleadoId, fecha],
    );
    if (!activa[0]) return NextResponse.json({ error: "Primero justifica la falta para adjuntar evidencia." }, { status: 409 });
    const doc = await subirDocumentoPorTipo({
      empresaId,
      empleadoId,
      tipoDocumento: tipoDocumentoEvidenciaJustificacion(fecha),
      prefijo: `justif_${empleadoId}`,
      usuario: guard.session.username,
      file,
      accionAuditoria: "justificacion_falta_evidencia_adjuntada",
      detalleAuditoria: `Justificación de falta · empleado #${empleadoId} · ${fecha}`,
    });
    return NextResponse.json({ mensaje: "Evidencia adjuntada.", evidencia: { id: doc.id, nombre: doc.nombreOriginal, subidoEn: doc.subidoEn, subidoPor: doc.subidoPor } }, { status: 201 });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
