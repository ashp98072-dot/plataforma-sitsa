import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { tx, rows, insert, type Contexto } from "./repository";
import { ErrorCB2 } from "./model";
import { cambioDocumento, huellaDocumento, verificarRecibo, type EdicionDocumento, type ResultadoDocumento, type TipoDocumento } from "./documentos-model";

export function documentosHabilitados() { return process.env.CB2_DOCUMENTOS_FASE2 === "1"; }
export function exigirDocumentos() { if (!documentosHabilitados()) throw new ErrorCB2("Edición documental no habilitada.", 503); }
export async function leerDocumento(empresa: number, proveedor: number, facturaId: number) {
    exigirDocumentos();
    const c = await getPool().getConnection();
    try {
        const [f] = await rows(c, `SELECT id,moneda,revision_documental,DATE_FORMAT(fecha_factura,'%Y-%m-%d') AS fecha,total_documental
          FROM flota_cb2_facturas WHERE empresa_id=? AND proveedor_id=? AND id=?`, [empresa, proveedor, facturaId]);
        if (!f) throw new ErrorCB2("Factura no encontrada.", 404);
        return { facturaId: Number(f.id), moneda: String(f.moneda), revision: Number(f.revision_documental), valores: { fecha: f.fecha == null ? null : String(f.fecha), total: f.total_documental == null ? null : String(f.total_documental) } };
    } finally { c.release(); }
}
export async function editarDocumento(ctx: Contexto, facturaId: number, op: EdicionDocumento, autorizarTipo: (tipo: TipoDocumento) => Promise<void>) {
    exigirDocumentos();
    if (ctx.proveedorId !== op.proveedorId) throw new ErrorCB2("Proveedor incompatible.", 409);
    const digest = huellaDocumento(ctx.empresaId, ctx.actor.id, facturaId, op);
    return tx(ctx, async c => {
        // tx bloquea proveedor y revalida sesión/capacidad antes de esta lectura.
        const [previo] = await rows(c, `SELECT factura_id,digest,usuario_id,tipo,resultado FROM flota_cb2_documento_operaciones
          WHERE empresa_id=? AND proveedor_id=? AND clave=? FOR UPDATE`, [ctx.empresaId, ctx.proveedorId, op.clave]);
        if (previo) {
            verificarRecibo({ digest: String(previo.digest), usuario_id: Number(previo.usuario_id), factura_id: Number(previo.factura_id) }, digest, ctx.actor.id, facturaId);
            await autorizarTipo(previo.tipo as TipoDocumento);
            return { ...JSON.parse(String(previo.resultado)) as ResultadoDocumento, repetida: true };
        }
        const [f] = await rows(c, `SELECT id,moneda,revision_documental,DATE_FORMAT(fecha_factura,'%Y-%m-%d') AS fecha,total_documental
          FROM flota_cb2_facturas WHERE empresa_id=? AND proveedor_id=? AND id=? FOR UPDATE`, [ctx.empresaId, ctx.proveedorId, facturaId]);
        if (!f) throw new ErrorCB2("Factura no encontrada.", 404);
        if (Number(f.revision_documental) !== op.revision) throw new ErrorCB2("La factura cambió; actualiza antes de guardar.", 409);
        if (!["GTQ", "USD"].includes(String(f.moneda))) throw new ErrorCB2("Moneda documental no compatible con esta fase.", 409);
        const antes = { fecha: f.fecha == null ? null : String(f.fecha), total: f.total_documental == null ? null : String(f.total_documental) };
        const { nuevo, tipo } = cambioDocumento(antes, op);
        await autorizarTipo(tipo); // Nunca usa una clasificación enviada por el navegador.
        const revision = op.revision + (tipo === "SIN_CAMBIO" ? 0 : 1);
        const resultado: ResultadoDocumento = { facturaId, moneda: String(f.moneda), revision, valores: nuevo, tipo };
        if (tipo !== "SIN_CAMBIO") {
            const [r] = await c.execute<import("mysql2").ResultSetHeader>(`UPDATE flota_cb2_facturas SET fecha_factura=?,total_documental=?,revision_documental=?
              WHERE empresa_id=? AND proveedor_id=? AND id=? AND revision_documental=?`, [nuevo.fecha, nuevo.total, revision, ctx.empresaId, ctx.proveedorId, facturaId, op.revision]);
            if (r.affectedRows !== 1) throw new ErrorCB2("Conflicto de revisión documental.", 409);
        }
        const ahora = ahoraLocal();
        const operacionId = await insert(c, "flota_cb2_documento_operaciones", { empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, factura_id: facturaId,
            clave: op.clave, digest, usuario_id: ctx.actor.id, tipo, revision_esperada: op.revision, revision_resultante: revision, resultado: JSON.stringify(resultado), creado_en: ahora });
        await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: "cb2_documento_actualizar",
            detalle: JSON.stringify({ version: 1, operacionId, empresaId: ctx.empresaId, proveedorId: ctx.proveedorId, facturaId, actorId: ctx.actor.id, usuario: ctx.actor.username, fecha: ahora,
                moneda: String(f.moneda), tipo, revisionAnterior: op.revision, revisionNueva: revision, antes, despues: nuevo, motivo: op.motivo, clave: op.clave, digest }) });
        return { ...resultado, repetida: false };
    });
}
