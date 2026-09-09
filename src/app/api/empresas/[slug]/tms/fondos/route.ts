import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { CATEGORIAS_GASTO } from "@/lib/tms/gastos";
import { ESTADOS_FONDO, crearSolicitudFondo, listarSolicitudesFondo } from "@/lib/tms/fondos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const p = new URL(req.url).searchParams;
  const estado = p.get("estado");
  const solicitudes = await listarSolicitudesFondo(guard.empresa.id, {
    estado: estado && (ESTADOS_FONDO as readonly string[]).includes(estado) ? (estado as (typeof ESTADOS_FONDO)[number]) : undefined,
    fechaDesde: p.get("fechaDesde") || undefined,
    fechaHasta: p.get("fechaHasta") || undefined,
  });
  return NextResponse.json(
    { solicitudes, estados: ESTADOS_FONDO },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const lineaSchema = z.object({
  categoria: z.enum(CATEGORIAS_GASTO),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  monto: z.number().positive().max(9999999999.99),
  // SOLICITUD-FONDOS-REPORTE-1: relaciones OPCIONALES — el servidor
  // resuelve y congela el snapshot legible (nombre/cargo/placa/cliente),
  // nunca se acepta uno enviado por el cliente HTTP (ver
  // resolverSnapshotLineaTx en fondos.ts).
  fechaViaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  vehiculoId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
});

const schema = z.object({
  requirenteEmpleadoId: z.number().int().positive().nullable().optional(),
  requirenteNombre: z.string().max(200).nullable().optional(),
  // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3 del ticket) — requirente
  // OPCIONAL asociado a un usuario real del sistema (seleccionable desde
  // el catálogo, ver /tms/gastos/catalogos): permite que el PDF muestre
  // su nombre real + firma manuscrita. Se valida contra esta empresa y
  // se resuelve del lado del servidor en crearSolicitudFondo — nunca se
  // confía en el nombre/firma que el cliente pretenda asociarle.
  requirenteUsuarioId: z.number().int().positive().nullable().optional(),
  fechaRequerimiento: z.string().min(1),
  observaciones: z.string().max(300).nullable().optional(),
  lineas: z.array(lineaSchema).min(1).max(40),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  try {
    // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§1 del ticket) — identidad real
    // de sesión (nunca del cliente): nombre real primero, username solo
    // si el usuario no tiene nombre real cargado, mismo criterio que
    // autorizarViatico. crearSolicitudFondo captura su firma de "Mi
        // "Mi firma" si existe (best-effort, no bloquea la creación si no la tiene).
    const solicitante = {
      usuarioId: guard.session.id,
      nombre: guard.session.nombre || guard.session.username,
      rol: guard.session.rol ?? null,
    };
    const solicitud = await crearSolicitudFondo(guard.empresa.id, parsed.data, guard.session.username, solicitante);
    return NextResponse.json({ mensaje: "Solicitud de fondo creada.", solicitud });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear la solicitud." }, { status: 400 });
  }
}
