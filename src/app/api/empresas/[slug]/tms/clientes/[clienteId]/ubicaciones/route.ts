import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireTenantCatalogoOperativoCliente,
  requireTenantProgramacionOTms,
} from "@/lib/tenant";
import {
  crearUbicacionCliente,
  listarUbicacionesCliente,
  type UbicacionCliente,
} from "@/lib/tms/cliente-ubicaciones";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

/**
 * VIAT-1 (punto 3) — ubicaciones/paradas guardadas de un cliente
 * (tms_clientes.id, la misma identidad que ya usa tms_planes_viaje.
 * cliente_id). Uso interno TMS/Programación/Operaciones > Rutas.
 *
 * OPS-5.2b: GET y POST aceptan programacion:ver/crear O tms:ver/crear —
 * confirmado por lectura que plan-form.tsx (guardarNuevaUbicacion) SÍ
 * crea ubicaciones directamente desde el formulario de Programación
 * (alta rápida de "Bodega Central", etc.), no solo las lee.
 *
 * OPS-5.2c: GET ahora también acepta rutas:ver (ver
 * requireTenantCatalogoOperativoCliente en tenant.ts — corrige el 403
 * detectado en OPS-5.2c.1 para un usuario con SOLO rutas:ver). El POST
 * de creación NO cambia — sigue siendo requireTenantProgramacionOTms
 * (programacion:crear O tms:crear): el barrido de OPS-5.2c.1 confirmó
 * que rutas/page.tsx no crea ubicaciones desde su pantalla, así que no
 * se agrega rutas:crear.
 *
 * El payload de GET se proyecta según `accesoCompleto`: quien NO tiene
 * tms:ver (Programación/Rutas) recibe solo {id, nombre, direccion,
 * tipo} — confirmado por barrido de consumidores que ni plan-form.tsx
 * ni rutas/page.tsx leen municipio/departamento/referencia/activo/
 * clienteId (rutas/page.tsx ni siquiera usa direccion/tipo, pero se
 * incluyen igual porque plan-form.tsx sí los necesita). `?todas=1`
 * (inactivas) queda reservado a quien tiene accesoCompleto.
 */
function proyectarOperativo(u: UbicacionCliente) {
  return {
    id: u.id,
    nombre: u.nombre,
    direccion: u.direccion,
    tipo: u.tipo,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantCatalogoOperativoCliente(slug);
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  // ?todas=1: administración en TMS (ver también inactivas para poder
  // reactivarlas). OPS-5.2c: la querystring del cliente nunca eleva
  // privilegios — solo se respeta cuando el permiso efectivo ya da
  // accesoCompleto. Sin el parámetro (o sin accesoCompleto), comportamiento
  // igual que antes (solo activas — selector de paradas en Programación/Rutas).
  const todasSolicitadas = new URL(req.url).searchParams.get("todas") === "1";
  const incluirInactivas = guard.accesoCompleto && todasSolicitadas;

  try {
    const ubicaciones = await listarUbicacionesCliente(guard.empresa.id, cid, {
      incluirInactivas,
    });
    const payload = guard.accesoCompleto
      ? ubicaciones
      : ubicaciones.map(proyectarOperativo);
    return NextResponse.json(
      { ubicaciones: payload },
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
