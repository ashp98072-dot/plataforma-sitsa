import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import {
  crearPersonalExterno,
  listarPersonalOperativo,
  TIPOS_PERSONAL,
  TIPOS_VINCULO,
  type FiltrosPersonalOperativo,
  type TipoPersonal,
  type TipoVinculo,
} from "@/lib/tms/personal-operativo";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — gestión de personal operativo
 * de TMS (propio / compartido / externo). Mismo permiso que Programación
 * (programacion:ver O tms:ver para leer; crear para escribir). NUNCA toca
 * empleados/planilla.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  try { await asegurarSchemaFlota(); } catch { /* la lectura degrada abajo */ }

  const url = new URL(req.url);
  const filtros: FiltrosPersonalOperativo = {};
  const tv = url.searchParams.get("tipoVinculo");
  if (tv && (TIPOS_VINCULO as readonly string[]).includes(tv)) filtros.tipoVinculo = tv as TipoVinculo;
  const tp = url.searchParams.get("tipo");
  if (tp && (TIPOS_PERSONAL as readonly string[]).includes(tp)) filtros.tipo = tp as TipoPersonal;
  const activo = url.searchParams.get("activo");
  if (activo === "1") filtros.activo = true;
  else if (activo === "0") filtros.activo = false;
  filtros.q = url.searchParams.get("q") ?? undefined;

  try {
    const personal = await listarPersonalOperativo(guard.empresa.id, filtros);
    return NextResponse.json({ personal }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ personal: [], aviso: "Aplica sql/migrate-2026-09-personal-operativo-compartido-externo.sql." });
  }
}

const crearExternoSchema = z.object({
  nombre: z.string().min(1).max(200),
  tipo: z.enum(["Piloto", "Auxiliar"]),
  telefono: z.string().max(80).nullish(),
  licencia: z.string().max(80).nullish(),
  empresaOrigenTexto: z.string().max(200).nullish(),
  empresaOrigenId: z.number().int().positive().nullish(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "crear");
  if (guard.error) return guard.error;
  try { await asegurarSchemaFlota(); } catch { /* ok */ }

  const parsed = crearExternoSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos del personal externo inválidos." }, { status: 400 });

  try {
    const actor = { usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username };
    const personal = await crearPersonalExterno(guard.empresa.id, parsed.data, actor);
    return NextResponse.json({ personal, mensaje: "Personal externo creado." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo crear el personal externo." },
      { status: 400 },
    );
  }
}
