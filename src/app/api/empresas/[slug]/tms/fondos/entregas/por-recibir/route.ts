import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { listarEntregasPorRecibir } from "@/lib/entregas/entregas";
import { respuestaFalloOperacion } from "@/lib/entregas/http";
import { aDto } from "@/lib/entregas/presentacion";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Bandeja «Entregas por recibir» de Solicitudes de fondo: solo la empresa de la sesión, EMITIDAS, modo SISTEMA, hacia un área
 * por la que el usuario puede actuar y nunca emitidas por él mismo (lo decide `listarEntregasPorRecibir`). Las presenciales no
 * aparecen aquí: se registran desde el detalle del documento. Sin polling: el cliente consulta al abrir y tras cada acción.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenantEntregas(slug);
    if (guard.error) return guard.error;
    const todas = await listarEntregasPorRecibir(guard.empresa.id, guard.actor);
    return NextResponse.json({ entregas: todas.filter((e) => e.modulo === "FONDOS").map((e) => aDto(e, guard.actor)) });
  } catch (error) {
    return respuestaFalloOperacion(error, "GET tms/fondos/entregas/por-recibir");
  }
}
