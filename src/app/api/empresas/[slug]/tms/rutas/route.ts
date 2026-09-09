import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms, requireTenantRutas } from "@/lib/tenant";
import { crearRuta, listarRutas } from "@/lib/tms/cliente-rutas";
import { crearRutaSchema, etiquetaCampoRutaFactory } from "@/lib/tms/rutas-validacion";
import { respuestaErrorValidacion } from "@/lib/validacion-http";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * VIAT-4 (punto 2 — Operaciones > Rutas) — catálogo maestro de rutas/
 * servicios preconfigurados por cliente. `GET` sirve tanto la
 * administración (Operaciones > Rutas, ?todas=1 incluye inactivas) como
 * el selector compacto de Programación (búsqueda por código y/o cliente
 * vía ?q=/?clienteId=, solo activas).
 *
 * OPS-5.2a: permiso propio `rutas` (con fallback a `tms` por
 * compatibilidad histórica) — ver requireTenantRutas en tenant.ts.
 *
 * OPS-5.2b: el modo ACOTADO (selector de Programación — sin `?todas=1`,
 * solo rutas activas) TAMBIÉN acepta programacion:ver como segunda
 * alternativa — confirmado por lectura que RutaSelect (usado por
 * plan-form.tsx) solo llama este GET sin `todas`, nunca el listado
 * completo. Principio de mínimo privilegio: programacion:ver deja
 * ELEGIR una ruta existente, pero el listado ADMINISTRATIVO (`?todas=1`,
 * incluye inactivas) sigue exigiendo ÚNICAMENTE rutas:ver O tms:ver —
 * programacion:ver nunca destapa esa vista completa.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const clienteIdRaw = url.searchParams.get("clienteId");
  const clienteId = clienteIdRaw && Number.isFinite(Number(clienteIdRaw)) ? Number(clienteIdRaw) : undefined;
  const q = url.searchParams.get("q") || undefined;
  const todas = url.searchParams.get("todas") === "1";

  let guard = await requireTenantRutas(slug, "ver");
  if (guard.error && !todas) {
    guard = await requireTenantProgramacionOTms(slug);
  }
  if (guard.error) return guard.error;

  try {
    const rutas = await listarRutas(guard.empresa.id, {
      clienteId,
      q,
      incluirInactivas: todas,
    });
    return NextResponse.json(
      { rutas },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET tms/rutas", e);
    return NextResponse.json({
      rutas: [],
      aviso: "No se pudo leer el catálogo de rutas. Verifica que la migración VIAT-4 esté aplicada.",
    });
  }
}

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§10/§11 del ticket) — "dato inválido" sin
 * decir qué campo era un problema real: ahora la validación fallida
 * devuelve un mensaje POR CAMPO ("No se pudo guardar la ruta:\n• Campo:
 * motivo.") + un mapa `campos` para que el frontend resalte el input
 * exacto (respuestaErrorValidacion, @/lib/validacion-http).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRutas(slug, "crear");
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => ({}));
  const parsed = crearRutaSchema.safeParse(body);
  if (!parsed.success) {
    return respuestaErrorValidacion(parsed.error, etiquetaCampoRutaFactory(body), "No se pudo guardar la ruta");
  }

  try {
    // §1 del ticket — identidad real de sesión (nunca username) para el
    // snapshot del historial de tarifa cuando la ruta nace con tarifa.
    const actor = { usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username };
    const ruta = await crearRuta(guard.empresa.id, parsed.data, actor);
    return NextResponse.json({ ruta, mensaje: "Ruta guardada." });
  } catch (e) {
    console.error("POST tms/rutas", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo guardar la ruta." },
      { status: 400 },
    );
  }
}
