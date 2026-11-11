import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { validarOrigenCB2 } from "./origin";
import { bodyAcotado } from "./http";
import { ErrorCB2 } from "./model";
import { exigirTerceros, listarTerceros, registrarTerceros, revisarTerceros } from "./terceros";
const revisionSchema = z.object({ proveedorId: z.number().int().positive(), id: z.number().int().positive(), revision: z.number().int().nonnegative(), estado: z.enum(["VERIFICADA", "REVOCADA"]) }).strict();
export async function tercerosHttp(req: Request, slug: string) {
  try {
    exigirTerceros();
    const lectura = req.method === "GET";
    const g = await requireTenantFlotaCombustible(slug, lectura ? "ver" : "conciliar", { soloLectura: lectura });
    if (g.error) return g.error;
    if (lectura) return NextResponse.json(await listarTerceros(g.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
    // D2: gestión solo para Admin autorizado; el creador nunca se toma del request.
    if (g.session.rol !== "Admin") throw new ErrorCB2("Gestionar terceros requiere administrador autorizado.", 403);
    validarOrigenCB2(req);
    const op = z.object({ proveedorId: z.number().int().positive() }).passthrough().parse(JSON.parse((await bodyAcotado(req, 16 * 1024)).toString("utf8")));
    const proveedorId = op.proveedorId;
    const ctx = { empresaId: g.empresa.id, proveedorId, actor: { id: g.session.id, username: g.session.username }, autorizar: async () => {
      exigirTerceros(); const actual = await requireTenantFlotaCombustible(slug, "conciliar");
      if (actual.error || actual.session.id !== g.session.id || actual.empresa.id !== g.empresa.id || actual.session.rol !== "Admin") throw new ErrorCB2("Permiso revocado.", 403);
    } };
    if (req.method === "POST") return NextResponse.json(await registrarTerceros(ctx, op), { status: 201 });
    const revision = revisionSchema.parse(op);
    return NextResponse.json(await revisarTerceros(ctx, revision.id, revision.revision, revision.estado));
  } catch (e) {
    const status = e instanceof ErrorCB2 ? e.status : e instanceof ZodError || e instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ error: e instanceof ErrorCB2 ? e.message : "No se pudo procesar la identidad externa." }, { status });
  }
}
