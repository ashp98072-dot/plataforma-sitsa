import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireTenantCatalogoOperativoCliente,
  requireTenantModulo,
} from "@/lib/tenant";
import {
  crearContactoCliente,
  listarContactosCliente,
  type ContactoCliente,
} from "@/lib/tms/cliente-contactos";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

/**
 * VIAT-4 (punto 1) — contactos operativos de un cliente. Uso interno
 * TMS/Programación/Operaciones > Rutas. Mismo patrón que
 * /tms/clientes/[clienteId]/ubicaciones (VIAT-1).
 *
 * OPS-5.2b: GET acepta programacion:ver O tms:ver — el POST de abajo
 * sigue exigiendo tms:crear sin cambios: confirmado por lectura que
 * plan-form.tsx solo hace GET aquí (nunca crea un contacto desde el
 * formulario de Programación).
 *
 * OPS-5.2c: GET ahora también acepta rutas:ver (ver
 * requireTenantCatalogoOperativoCliente en tenant.ts — corrige el 403
 * detectado en OPS-5.2c.1 para un usuario con SOLO rutas:ver). Además,
 * el payload se proyecta según `accesoCompleto`: quien NO tiene tms:ver
 * (Programación/Rutas) recibe solo {id, nombre, cargo, telefono} —
 * confirmado por barrido de consumidores (OPS-5.2c/OPS-5.2c.1) que ni
 * plan-form.tsx ni rutas/page.tsx leen email/observaciones/activo/
 * clienteId. `?todas=1` (inactivos) queda reservado a quien tiene
 * accesoCompleto — un caller operativo no puede elevar el payload ni
 * incluir inactivos solo agregando el querystring, porque `activo` ni
 * siquiera forma parte de su payload.
 */
function proyectarOperativo(c: ContactoCliente) {
  return {
    id: c.id,
    nombre: c.nombre,
    cargo: c.cargo,
    telefono: c.telefono,
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
  const todasSolicitadas = new URL(req.url).searchParams.get("todas") === "1";
  // OPS-5.2c: la querystring del cliente nunca eleva privilegios — solo
  // se respeta `todas=1` cuando el permiso efectivo ya da accesoCompleto.
  const incluirInactivos = guard.accesoCompleto && todasSolicitadas;

  try {
    const contactos = await listarContactosCliente(guard.empresa.id, cid, {
      incluirInactivos,
    });
    const payload = guard.accesoCompleto
      ? contactos
      : contactos.map(proyectarOperativo);
    return NextResponse.json(
      { contactos: payload },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET tms/clientes/[clienteId]/contactos", e);
    return NextResponse.json({
      contactos: [],
      aviso: "No se pudo leer el catálogo de contactos. Verifica que la migración VIAT-4 esté aplicada.",
    });
  }
}

const schema = z.object({
  nombre: z.string().min(1).max(160),
  cargo: z.string().max(120).optional(),
  telefono: z.string().max(80).optional(),
  email: z.string().max(160).optional(),
  observaciones: z.string().max(300).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
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
    const contacto = await crearContactoCliente(guard.empresa.id, cid, parsed.data);
    return NextResponse.json({ contacto, mensaje: "Contacto guardado." });
  } catch (e) {
    console.error("POST tms/clientes/[clienteId]/contactos", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo guardar el contacto." },
      { status: 400 },
    );
  }
}
