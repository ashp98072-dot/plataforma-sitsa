import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";
import { ErrorArchivoProveedor, validarArchivoImportacion } from "../combustible-importacion-parser";
import { ErrorCB2, confirmar, seleccion, moneda, reanudar, asociar, id } from "./model";
import * as service from "./service";
import { validarOrigenCB2 } from "./origin";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function bodyAcotado(req: Request, max: number) {
    if (!req.body)
        throw new ErrorCB2("Solicitud vacia.", 400);
    const reader = req.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.length;
            if (total > max) {
                await reader.cancel();
                throw new ErrorCB2("Solicitud demasiado grande.", 413);
            }
            chunks.push(value);
        }
        return Buffer.concat(chunks);
    }
    finally {
        reader.releaseLock();
    }
}
export type Accion = "preview" | "confirmar" | "reanudar" | "asociar" | "importaciones" | "consumos" | "facturas" | "filas" | "archivo";
export async function cb2Http(req: Request, slug: string, accion: Accion, rawId?: string) {
    const lectura = ["importaciones", "consumos", "facturas", "filas", "archivo"].includes(accion);
    const g = await requireTenantFlotaCombustible(slug, lectura ? "ver" : "conciliar", { soloLectura: lectura || accion === "preview" });
    if (g.error)
        return g.error;
    try {
        if (accion === "reanudar" && g.session.rol !== "Admin")
            throw new ErrorCB2("Reanudar requiere Admin hasta disponer de capacidad especifica.", 403);
        if (!lectura)
            validarOrigenCB2(req);
        const ctx = { empresaId: g.empresa.id, proveedorId: 0, actor: { id: g.session.id, username: g.session.username }, autorizar: async () => {
                const actual = await requireTenantFlotaCombustible(slug, "conciliar");
                if (actual.error || actual.session.id !== g.session.id || actual.empresa.id !== g.empresa.id || (accion === "reanudar" && actual.session.rol !== "Admin"))
                    throw new ErrorCB2("Autorizacion cambio; operacion cancelada.", 403);
            } };
        let resultado: unknown;
        if (lectura) {
            const url = new URL(req.url), after = z.coerce.number().int().min(0).max(2147483647).parse(url.searchParams.get("despues") ?? 0), limit = z.coerce.number().int().min(1).max(500).parse(url.searchParams.get("limite") ?? 100);
            const iid = rawId === undefined ? undefined : id.parse(Number(rawId));
            if (accion === "archivo") {
                const f = await service.archivo(ctx.empresaId, iid!);
                return new Response(new Uint8Array(f.buffer), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="cb2-${iid}.xlsx"` } });
            }
            const filtros = z.object({proveedorId:id.optional(),estado:z.enum(["PENDIENTE_FACTURA","FACTURADO","PARCIAL","COMPLETA","SOLO_EVIDENCIA"]).optional(),desde:z.iso.date().optional(),hasta:z.iso.date().optional(),buscar:z.string().trim().max(128).optional()}).parse({
                proveedorId:url.searchParams.has("proveedorId")?Number(url.searchParams.get("proveedorId")):undefined,
                estado:url.searchParams.get("estado")||undefined,desde:url.searchParams.get("desde")||undefined,hasta:url.searchParams.get("hasta")||undefined,buscar:url.searchParams.get("buscar")||undefined,
            });
            if(filtros.desde && filtros.hasta && filtros.desde>filtros.hasta)throw new ErrorCB2("Rango de fechas invalido.",400);
            const tipo = accion as "importaciones" | "consumos" | "facturas" | "filas";
            resultado = Object.values(filtros).some(v=>v!==undefined) ? await service.consultar(ctx.empresaId,tipo,iid,limit,after,filtros) : await service.consultar(ctx.empresaId,tipo,iid,limit,after);
        }
        else if (accion === "preview" || accion === "confirmar") {
            const type = req.headers.get("content-type") ?? "";
            if (!type.startsWith("multipart/form-data;"))
                throw new ErrorCB2("Se requiere multipart.", 400);
            const b = await bodyAcotado(req, MAX_UPLOAD_BYTES + 65536);
            let form: FormData;
            try {
                form = await new Response(b, { headers: { "Content-Type": type } }).formData();
            }
            catch {
                throw new ErrorCB2("Multipart invalido.", 400);
            }
            const file = form.get("file");
            if (!(file instanceof File))
                throw new ErrorCB2("Archivo requerido.", 400);
            validarArchivoImportacion(file);
            let choices: unknown;
            try {
                choices = JSON.parse(String(form.get("seleccion") ?? "[]"));
            }
            catch {
                throw new ErrorCB2("Seleccion invalida.", 400);
            }
            const common = z.object({ proveedorId: id, perfil: z.enum(["HALEL", "SHELL"]), moneda, seleccion }).parse({ proveedorId: Number(form.get("proveedorId")), perfil: form.get("perfil"), moneda: form.get("moneda"), seleccion: choices });
            ctx.proveedorId = common.proveedorId;
            const entrada = { perfil: common.perfil, moneda: common.moneda, seleccion: common.seleccion };
            const buffer = Buffer.from(await file.arrayBuffer());
            if (accion === "preview")
                resultado = await service.preview(ctx, buffer, entrada);
            else {
                const op = confirmar.parse({ ...common, clave: form.get("clave"), token: form.get("token") });
                resultado = await service.confirmarArchivo(ctx, buffer, file.name, entrada, op.clave, op.token);
            }
        }
        else {
            let json: unknown;
            try {
                json = JSON.parse((await bodyAcotado(req, 512 * 1024)).toString("utf8"));
            }
            catch (e) {
                if (e instanceof ErrorCB2)
                    throw e;
                throw new ErrorCB2("JSON invalido.", 400);
            }
            if (accion === "reanudar") {
                const op = reanudar.parse(json);
                ctx.proveedorId = op.proveedorId;
                resultado = await service.reanudarArchivo(ctx, op);
            }
            else {
                const op = asociar.parse(json);
                ctx.proveedorId = op.proveedorId;
                resultado = await service.asociarFactura(ctx, op);
            }
        }
        return NextResponse.json(resultado, { headers });
    }
    catch (e) {
        if (e instanceof ZodError)
            return NextResponse.json({ error: "Datos invalidos. Verifica IDs, campos, precision y limites." }, { status: 400, headers });
        if (e instanceof ErrorCB2 || e instanceof ErrorArchivoProveedor)
            return NextResponse.json({ error: e.message }, { status: e.status, headers });
        console.error("[combustibles-cb2] Operacion no completada");
        return NextResponse.json({ error: "No se pudo completar la operacion CB2." }, { status: 500, headers });
    }
}
