import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos, requireTenantGastosAutorizar } from "@/lib/tenant";
import { CATEGORIAS_GASTO } from "@/lib/tms/gastos";
import {
  actualizarSolicitudFondo,
  cambiarEstadoSolicitudFondo,
  MENSAJE_FIRMA_REQUERIDA_AUTORIZAR,
  obtenerSolicitudFondo,
} from "@/lib/tms/fondos";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const solicitud = await obtenerSolicitudFondo(guard.empresa.id, Number(id));
  if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  return NextResponse.json({ solicitud });
}

const lineaSchema = z.object({
  categoria: z.enum(CATEGORIAS_GASTO),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  monto: z.number().positive().max(9999999999.99),
  fechaViaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  vehiculoId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
  empleadoNombreOverride: z.string().trim().max(200).nullable().optional(),
  cuentaOverride: z.string().trim().max(100).nullable().optional(),
  cargoOverride: z.string().trim().max(150).nullable().optional(),
});

const schema = z.object({
  accion: z.enum(["autorizar", "rechazar", "liquidar", "editar"]),
  // autorizar (legado, solo el vínculo RRHH opcional — el nombre/firma
  // real ya NUNCA viene del cliente, ver más abajo) / rechazar
  autorizanteEmpleadoId: z.number().int().positive().nullable().optional(),
  motivoRechazo: z.string().max(300).nullable().optional(),
  // SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — solo para
  // accion:"editar". Mismas líneas que el POST de creación (fondos/route.ts).
  fechaRequerimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requirenteEmpleadoId: z.number().int().positive().nullable().optional(),
  requirenteNombre: z.string().max(200).nullable().optional(),
  // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§3) — ver POST de creación (fondos/route.ts).
  requirenteUsuarioId: z.number().int().positive().nullable().optional(),
  solicitanteUsuarioId: z.number().int().positive().optional(),
  observaciones: z.string().max(300).nullable().optional(),
  lineas: z.array(lineaSchema).min(1).max(40).optional(),
});

/**
 * accion:"autorizar"|"rechazar"|"liquidar" — decisión administrativa
 * (cambia de estado, nunca toca las líneas).
 * accion:"editar" — edita encabezado y/o REEMPLAZA las líneas MIENTRAS
 * la solicitud está Pendiente (actualizarSolicitudFondo valida el
 * estado; aquí solo se enruta).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  // FONDOS-AUTORIZAR-PERMISO-1 — "autorizar" es una acción independiente:
  // exige el permiso propio "gastos_autorizar" (requireTenantGastosAutorizar,
  // SIN fallback a gastos:editar / tms:editar). El resto de escrituras de
  // este endpoint (rechazar / liquidar / editar) siguen bajo "gastos:editar".
  const guard = parsed.data.accion === "autorizar"
    ? await requireTenantGastosAutorizar(slug, "editar")
    : await requireTenantGastos(slug, "editar");
  if (guard.error) return guard.error;

  try {
    if (parsed.data.accion === "editar") {
      const { fechaRequerimiento, requirenteEmpleadoId, requirenteNombre, requirenteUsuarioId, solicitanteUsuarioId, observaciones, lineas } = parsed.data;
      const solicitud = await actualizarSolicitudFondo(guard.empresa.id, Number(id), {
        fechaRequerimiento, requirenteEmpleadoId, requirenteNombre, requirenteUsuarioId, solicitanteUsuarioId, observaciones, lineas,
      }, guard.session.username);
      if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
      return NextResponse.json({ mensaje: "Solicitud actualizada.", solicitud });
    }

    // SOLICITUD-FONDOS-PDF-AUTORIZADO-1 (§2 del ticket) — autorizar EXIGE
    // la firma manuscrita real de "Mi firma" del usuario de sesión (nunca
    // un nombre/firma que el cliente HTTP pretenda mandar). Se verifica
    // ANTES de llamar a cambiarEstadoSolicitudFondo (falla rápido, sin
    // tocar la base de datos si no hay firma) — mismo criterio que
    // autorizarViatico valida su imagen ANTES de la lib (ver
    // .../viaticos/[id]/autorizar/route.ts).
    let autorizante: { usuarioId: number; nombre: string; rol: string | null; imagen: { bytes: ArrayBuffer; original: string } } | null = null;
    if (parsed.data.accion === "autorizar") {
      const bytes = await leerBytesFirmaGuardada(guard.session.id);
      if (!bytes) {
        return NextResponse.json({ error: MENSAJE_FIRMA_REQUERIDA_AUTORIZAR }, { status: 400 });
      }
      autorizante = {
        usuarioId: guard.session.id,
        nombre: guard.session.nombre || guard.session.username,
        rol: guard.session.rol ?? null,
        imagen: bytes,
      };
    }

    const solicitud = await cambiarEstadoSolicitudFondo(guard.empresa.id, Number(id), parsed.data.accion, {
      usuario: guard.session.username,
      autorizanteEmpleadoId: parsed.data.autorizanteEmpleadoId,
      autorizante,
      motivoRechazo: parsed.data.motivoRechazo,
    });
    if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
    return NextResponse.json({ mensaje: "Solicitud actualizada.", solicitud });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la solicitud." }, { status: 400 });
  }
}
