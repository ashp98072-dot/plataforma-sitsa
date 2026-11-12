import { fusionarVehiculos } from "./vehiculos-fusion";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireTenantFlota } from "@/lib/tenant";
import { validarOrigenCB2 } from "./cb2/origin";
import { bodyAcotado } from "./cb2/http";
import { ErrorCB2 } from "./cb2/model";
import { desactivarDuplicado, listarPlacasDuplicadas, revisarPlacaDuplicada } from "./vehiculos-duplicados";
const id = z.number().int().positive().max(2147483647);
const schema = z.object({ id, conservarId: id, revision: z.string().regex(/^[0-9a-f]{64}$/), motivo: z.string().trim().min(10).max(1000), destinoRevision: z.string().regex(/^[0-9a-f]{64}$/).optional(), fusionar: z.boolean().optional(), confirmado: z.literal(true) }).strict();
export async function duplicadosHttp(req: Request, slug: string) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const lectura = req.method === "GET", guard = await requireTenantFlota(slug, "flota_vehiculos", lectura ? "ver" : "editar");
    if (guard.error) return guard.error;
    if (guard.session.rol !== "Admin") throw new ErrorCB2("La revisión de duplicados requiere Admin.", 403);
    if (lectura) {
      const raw = new URL(req.url).searchParams.get("id");
      return NextResponse.json(raw === null ? await listarPlacasDuplicadas(guard.empresa.id) : await revisarPlacaDuplicada(guard.empresa.id, id.parse(Number(raw))), { headers });
    }
    validarOrigenCB2(req);
    const op = schema.parse(JSON.parse((await bodyAcotado(req, 4096)).toString("utf8")));
    const ctx = { usuarioId: guard.session.id, empresaId: guard.empresa.id, usuario: guard.session.username, autorizar: async () => {
      const actual = await requireTenantFlota(slug, "flota_vehiculos", "editar");
      if (actual.error || actual.session.id !== guard.session.id || actual.empresa.id !== guard.empresa.id || actual.session.rol !== "Admin") throw new ErrorCB2("Permiso revocado.", 403);
    } };
    return NextResponse.json(await (op.fusionar ? fusionarVehiculos(ctx, op) : desactivarDuplicado(ctx, op)), { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ErrorCB2 ? e.message : "No se pudo completar la revisión. No se autoriza desactivar sin comprobar todas las referencias." }, { status: e instanceof ErrorCB2 ? e.status : e instanceof ZodError || e instanceof SyntaxError ? 400 : 500, headers });
  }
}
