import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { ErrorCB2, id } from "./model";
import { validarOrigenCB2 } from "./origin";
import { bodyAcotado } from "./http";
import { documentosHabilitados, exigirDocumentos, leerDocumento, editarDocumento } from "./documentos";
import { editarDocumentoSchema, type TipoDocumento } from "./documentos-model";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function documentoHttp(req: Request, slug: string, rawId: string) {
    const g = await requireTenantFlotaCombustible(slug, "ver", { soloLectura: true });
    if (g.error) return g.error;
    try {
        if (req.method !== "GET" && req.method !== "PATCH") return NextResponse.json({ error: "Método no permitido." }, { status: 405, headers });
        const facturaId = id.parse(Number(rawId));
        if (req.method === "GET" && !documentosHabilitados()) return NextResponse.json({ habilitado: false }, { headers });
        exigirDocumentos();
        const autorizar = async (tipo: TipoDocumento = "COMPLETAR") => {
            const base = await requireTenantFlotaCombustible(slug, "completar_documentos", { soloLectura: true });
            if (base.error || base.empresa.id !== g.empresa.id || base.session.id !== g.session.id) throw new ErrorCB2("Sin permiso para completar documentos.", 403);
            if (tipo === "CORREGIR") {
                const correccion = await requireTenantFlotaCombustible(slug, "corregir_documentos", { soloLectura: true });
                if (correccion.error || correccion.empresa.id !== g.empresa.id || correccion.session.id !== g.session.id) throw new ErrorCB2("Sin permiso para corregir documentos declarados.", 403);
            }
        };
        if (req.method === "GET") {
            const proveedorId = id.parse(Number(new URL(req.url).searchParams.get("proveedorId")));
            const documento = await leerDocumento(g.empresa.id, proveedorId, facturaId);
            let completar = false, corregir = false;
            try { await autorizar(); completar = true; } catch (e) { if (!(e instanceof ErrorCB2) || e.status !== 403) throw e; }
            if (completar) { try { await autorizar("CORREGIR"); corregir = true; } catch (e) { if (!(e instanceof ErrorCB2) || e.status !== 403) throw e; } }
            return NextResponse.json({ habilitado: true, actorId: g.session.id, documento, permisos: { completar, corregir } }, { headers });
        }
        validarOrigenCB2(req);
        await autorizar();
        if (!req.headers.get("content-type")?.startsWith("application/json")) throw new ErrorCB2("Se requiere JSON.", 400);
        let json: unknown;
        try { json = JSON.parse((await bodyAcotado(req, 16384)).toString("utf8")); }
        catch (e) { if (e instanceof ErrorCB2) throw e; throw new ErrorCB2("JSON inválido.", 400); }
        const op = editarDocumentoSchema.parse(json);
        const ctx = { empresaId: g.empresa.id, proveedorId: op.proveedorId, actor: { id: g.session.id, username: g.session.username }, autorizar: () => autorizar() };
        return NextResponse.json(await editarDocumento(ctx, facturaId, op, autorizar), { headers });
    } catch (e) {
        if (e instanceof ZodError) return NextResponse.json({ error: "Verifica fecha, total de hasta seis decimales, revisión, clave y motivo." }, { status: 400, headers });
        if (e instanceof ErrorCB2) return NextResponse.json({ error: e.message, incierto: e.incierto }, { status: e.status, headers });
        const code = (e as { code?: string }).code;
        if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return NextResponse.json({ error: "Edición documental no disponible; requiere habilitación del esquema." }, { status: 503, headers });
        console.error("[cb2-documentos] Operación documental no completada");
        return NextResponse.json({ error: "No se pudo certificar el resultado. Conserva y reintenta la misma solicitud.", incierto: true }, { status: 503, headers });
    }
}
