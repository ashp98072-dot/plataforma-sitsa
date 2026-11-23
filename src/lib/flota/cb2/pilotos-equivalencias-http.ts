import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { validarOrigenCB2 } from "./origin";
import { bodyAcotado } from "./http";
import { ErrorCB2 } from "./model";
import { corregirEquivalenciaPiloto, listarEquivalenciasPilotos } from "./pilotos-equivalencias";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const correccion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("QUITAR"), nombreHash: hash }).strict(),
  z.object({ accion: z.literal("EMPLEADO"), nombreHash: hash, empleadoId: z.number().int().positive() }).strict(),
]);

/** GET: lista las equivalencias de la empresa (permiso de ver). POST: corrige una (solo Admin, mismo origen, empresa y usuario SIEMPRE de la sesión). No toca consumos históricos. */
export async function pilotosEquivalenciasHttp(req: Request, slug: string) {
  try {
    const lectura = req.method === "GET";
    const g = await requireTenantFlotaCombustible(slug, lectura ? "ver" : "conciliar", { soloLectura: lectura });
    if (g.error) return g.error;
    if (lectura) return NextResponse.json(await listarEquivalenciasPilotos(g.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
    if (g.session.rol !== "Admin") throw new ErrorCB2("Corregir equivalencias de pilotos requiere Admin.", 403);
    validarOrigenCB2(req);
    const op = correccion.parse(JSON.parse((await bodyAcotado(req, 4 * 1024)).toString("utf8")));
    return NextResponse.json(await corregirEquivalenciaPiloto({ empresaId: g.empresa.id, actor: { id: g.session.id, username: g.session.username } }, op), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const status = e instanceof ErrorCB2 ? e.status : e instanceof ZodError || e instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: e instanceof ErrorCB2 ? e.message : "No se pudo procesar la equivalencia." }, { status });
  }
}
