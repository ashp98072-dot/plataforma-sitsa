import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";
import {
  editarJustificacion,
  justificarFalta,
  obtenerContextoJustificacion,
} from "@/lib/rrhh/justificaciones-faltas";
import { tipoDocumentoEvidenciaJustificacion } from "@/lib/rrhh/justificaciones-faltas-shared";
import { listarDocumentosPorTipo } from "@/lib/rrhh/documentos-por-tipo";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * RRHH — justificación de faltas desde Reportes de asistencia. La empresa y el actor salen SIEMPRE de la sesión.
 *
 * GET  ?empleadoId=&fecha=  → contexto del día: estado actual, justificación (si hay), evidencias e impacto en planilla.
 *                             Permiso de lectura de Reportes de RRHH (`reportes:ver`).
 * POST {empleadoId, fecha, tipo, observacion?} → justifica la falta. Permiso `incidencias:crear`.
 * PATCH {id, expectedVersion, tipo?, observacion?} → edita la justificación. Permiso `incidencias:editar`.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "reportes", "ver");
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const empleadoId = Number(url.searchParams.get("empleadoId"));
  const fecha = url.searchParams.get("fecha") ?? "";
  if (!Number.isInteger(empleadoId) || empleadoId <= 0) return NextResponse.json({ error: "Empleado inválido." }, { status: 400 });
  try {
    const contexto = await obtenerContextoJustificacion(guard.empresa.id, empleadoId, fecha);
    if (!contexto) return NextResponse.json({ error: "No se encontró ese día para el empleado." }, { status: 404 });
    const evidencias = contexto.justificacion
      ? await listarDocumentosPorTipo(guard.empresa.id, empleadoId, tipoDocumentoEvidenciaJustificacion(fecha))
      : [];
    return NextResponse.json(
      {
        ...contexto,
        evidencias: evidencias.map((d) => ({ id: d.id, nombre: d.nombreOriginal, subidoEn: d.subidoEn, subidoPor: d.subidoPor })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}

const crearSchema = z
  .object({
    empleadoId: z.number().int().positive(),
    fecha: z.string().min(10).max(10),
    tipo: z.string().max(80),
    observacion: z.string().max(1000).nullish(),
  })
  .strict();

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "incidencias", "crear");
  if (guard.error) return guard.error;
  const parsed = crearSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida: se requieren empleado, fecha y tipo." }, { status: 400 });
  try {
    const r = await justificarFalta({ empresaId: guard.empresa.id, usuario: guard.session.username }, parsed.data);
    return NextResponse.json(
      { mensaje: r.idempotente ? "La falta ya estaba justificada." : "Falta justificada.", idempotente: r.idempotente, evento: r.evento, justificacion: r.justificacion },
      { status: r.idempotente ? 200 : 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}

const editarSchema = z
  .object({
    id: z.number().int().positive(),
    expectedVersion: z.number().int().min(1).max(2147483647),
    tipo: z.string().max(80).optional(),
    observacion: z.string().max(1000).nullable().optional(),
  })
  .strict();

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "incidencias", "editar");
  if (guard.error) return guard.error;
  const parsed = editarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida: se requieren id y expectedVersion." }, { status: 400 });
  try {
    const { expectedVersion, ...resto } = parsed.data;
    const r = await editarJustificacion(
      { empresaId: guard.empresa.id, usuario: guard.session.username },
      { ...resto, versionEsperada: expectedVersion },
    );
    return NextResponse.json({ mensaje: r.evento ? "Justificación actualizada." : "Sin cambios.", idempotente: r.idempotente, evento: r.evento, justificacion: r.justificacion });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
