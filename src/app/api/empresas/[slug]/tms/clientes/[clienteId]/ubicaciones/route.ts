import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { crearUbicacionCliente, listarUbicacionesCliente } from "@/lib/tms/cliente-ubicaciones";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

/**
 * VIAT-1 (punto 3) — ubicaciones/paradas guardadas de un cliente
 * (tms_clientes.id, la misma identidad que ya usa tms_planes_viaje.
 * cliente_id). Uso interno TMS/Programación.
 *
 * OPS-5.2b: GET y POST aceptan programacion:ver/crear O tms:ver/crear —
 * confirmado por lectura que plan-form.tsx (guardarNuevaUbicacion) SÍ
 * crea ubicaciones directamente desde el formulario de Programación
 * (alta rápida de "Bodega Central", etc.), no solo las lee.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  // ?todas=1: administración en TMS (ver también inactivas para poder
  // reactivarlas). Sin el parámetro, comportamiento igual que antes (solo
  // activas — selector de paradas en Programación).
  const todas = new URL(req.url).searchParams.get("todas") === "1";

  try {
    const ubicaciones = await listarUbicacionesCliente(guard.empresa.id, cid, {
      incluirInactivas: todas,
    });
    return NextResponse.json(
      { ubicaciones },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET tms/clientes/[clienteId]/ubicaciones", e);
    return NextResponse.json({
      ubicaciones: [],
      aviso: "No se pudo leer el catálogo de ubicaciones. Verifica que la migración VIAT-1 esté aplicada.",
    });
  }
}

const schema = z.object({
  nombre: z.string().min(1).max(160),
  direccion: z.string().max(300).optional(),
  municipio: z.string().max(120).optional(),
  departamento: z.string().max(120).optional(),
  referencia: z.string().max(300).optional(),
  tipo: z.enum(["CARGA", "ENTREGA", "AMBOS"]).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "crear");
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const ubicacion = await crearUbicacionCliente(guard.empresa.id, cid, parsed.data);
    return NextResponse.json({ ubicacion, mensaje: "Ubicación guardada." });
  } catch (e) {
    console.error("POST tms/clientes/[clienteId]/ubicaciones", e);
    return NextResponse.json(
      { error: "No se pudo guardar la ubicación." },
      { status: 500 },
    );
  }
}
