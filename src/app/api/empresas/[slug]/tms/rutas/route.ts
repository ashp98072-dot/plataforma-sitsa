import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRutas } from "@/lib/tenant";
import { crearRuta, listarRutas } from "@/lib/tms/cliente-rutas";

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
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRutas(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const clienteIdRaw = url.searchParams.get("clienteId");
  const clienteId = clienteIdRaw && Number.isFinite(Number(clienteIdRaw)) ? Number(clienteIdRaw) : undefined;
  const q = url.searchParams.get("q") || undefined;
  const todas = url.searchParams.get("todas") === "1";

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

const paradaSchema = z.object({
  tipo: z.enum(["Carga", "Descarga", "Entrega"]).optional(),
  lugarNombre: z.string().min(1),
  clienteUbicacionId: z.number().int().positive().optional(),
});

const schema = z.object({
  clienteId: z.number().int().positive(),
  codigo: z.string().min(1).max(40),
  nombre: z.string().max(200).optional(),
  ubicacionCargaId: z.number().int().positive().optional(),
  lugarCargaTexto: z.string().max(300).optional(),
  destinoDescripcion: z.string().max(300).optional(),
  horaHabitual: z.string().max(20).optional(),
  contactoClienteId: z.number().int().positive().optional(),
  observaciones: z.string().max(300).optional(),
  paradas: z.array(paradaSchema).max(20).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRutas(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
    const ruta = await crearRuta(guard.empresa.id, parsed.data);
    return NextResponse.json({ ruta, mensaje: "Ruta guardada." });
  } catch (e) {
    console.error("POST tms/rutas", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo guardar la ruta." },
      { status: 400 },
    );
  }
}
