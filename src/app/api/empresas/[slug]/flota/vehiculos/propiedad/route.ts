import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireTenantFlota } from "@/lib/tenant";
import { ErrorPropiedad, guardarPropiedad } from "@/lib/flota/propiedad";

type Ctx = { params: Promise<{ slug: string }> };
async function escribir(req: Request, ctx: Ctx, crear: boolean) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", crear ? "crear" : "editar");
  if (guard.error) return guard.error;
  // Origen público fijado por servidor; no confiar en Host/X-Forwarded-Host.
  const publicOrigin = process.env.FLOTA_PUBLIC_ORIGIN ?? "https://novalvion.com";
  let configured: URL;
  try { configured = new URL(publicOrigin); }
  catch { return NextResponse.json({ error: "Configuración de origen inválida." }, { status: 503 }); }
  if (configured.protocol !== "https:" || configured.origin !== publicOrigin)
    return NextResponse.json({ error: "Configuración de origen inválida." }, { status: 503 });
  const trusted = new Set([publicOrigin]);
  const url = new URL(req.url);
  if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) trusted.add(url.origin);
  if (!trusted.has(req.headers.get("origin") ?? "") || req.headers.get("sec-fetch-site") === "cross-site")
    return NextResponse.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  try {
    const body = await req.text();
    if (body.length > 32768) return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });
    return NextResponse.json(await guardarPropiedad(guard.empresa.id, guard.session.username, JSON.parse(body), crear));
  } catch (e) {
    const status = e instanceof ErrorPropiedad ? e.status : e instanceof ZodError || e instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: e instanceof ErrorPropiedad ? e.message : status === 400 ? "Revisa los datos del propietario y del vehículo." : "No se guardó la operación. Contacta al administrador." }, { status });
  }
}
export const POST = (req: Request, ctx: Ctx) => escribir(req, ctx, true);
export const PATCH = (req: Request, ctx: Ctx) => escribir(req, ctx, false);
