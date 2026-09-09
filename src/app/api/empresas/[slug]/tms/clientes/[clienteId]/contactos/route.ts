import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireTenantCatalogoOperativoCliente,
  requireTenantModulo,
} from "@/lib/tenant";
import {
  buscarPosiblesDuplicadosContacto,
  crearContactoCliente,
  listarContactosCliente,
  type ContactoCliente,
} from "@/lib/tms/cliente-contactos";
import { respuestaErrorValidacion } from "@/lib/validacion-http";

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

const ETIQUETAS: Record<string, string> = {
  nombre: "Nombre", cargo: "Cargo / área", telefono: "Teléfono", email: "Email", observaciones: "Observaciones",
};

const schema = z.object({
  nombre: z.string().min(1, "es obligatorio.").max(160, "máximo 160 caracteres."),
  cargo: z.string().max(120, "máximo 120 caracteres.").optional(),
  telefono: z.string().max(80, "máximo 80 caracteres.").optional(),
  email: z.string().max(160, "máximo 160 caracteres.").optional(),
  observaciones: z.string().max(300, "máximo 300 caracteres.").optional(),
  // RUTAS-TARIFARIO-HISTORIAL-1 (§8 del ticket) — el usuario ya vio la
  // advertencia de posible duplicado (409 más abajo) y decidió continuar.
  forzar: z.boolean().optional(),
});

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§7/§8 del ticket) — "+ Agregar contacto"
 * desde la captura de Ruta usa ESTE MISMO endpoint (nunca guarda el
 * contacto solo dentro de la ruta): antes de insertar, advierte
 * (409 + `posibleDuplicado`) si ya existe un contacto activo de este
 * cliente con el mismo email o teléfono — nunca bloquea por nombre
 * solo, y el caller puede confirmar reenviando `forzar: true`.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, clienteId } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return respuestaErrorValidacion(parsed.error, (path) => ETIQUETAS[String(path[0])] ?? String(path[0] || "Valor"), "No se pudo guardar el contacto");
  }

  try {
    if (!parsed.data.forzar) {
      const posibles = await buscarPosiblesDuplicadosContacto(guard.empresa.id, cid, parsed.data);
      if (posibles.length) {
        return NextResponse.json(
          {
            error: `Ya existe un contacto de este cliente con el mismo ${posibles[0].email && parsed.data.email?.trim().toLowerCase() === posibles[0].email.toLowerCase() ? "email" : "teléfono"} (${posibles[0].nombre}). ¿Deseas guardarlo de todas formas?`,
            posibleDuplicado: true,
            coincidencias: posibles,
          },
          { status: 409 },
        );
      }
    }
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
