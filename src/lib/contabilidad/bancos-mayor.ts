import type { RowDataPacket } from "mysql2";
import { AccesoContable, type AmbitoContable } from "./ambito";
import { textoBanco } from "./bancos-shared";
import { enSolicitudDeLectura, lineasMayor, type FiltrosFecha } from "./reportes/reportes";
import { aCentavos, deCentavos } from "./reportes/calculo";
const ESTADO = "Registrado";
export async function movimientosMayorBancario(empresaId: number, ambito: AmbitoContable, bancoId: number, f: FiltrosFecha) {
  const entidadId = ambito.entidadId;
  return enSolicitudDeLectura(async (c, filtros) => {
    const [entidades] = await c.query<RowDataPacket[]>("SELECT id,activa FROM cont_entidades WHERE empresa_id=? AND id=?", [empresaId, entidadId]);
    if (!entidades.length || (!ambito.admin && Number(entidades[0].activa) !== 1)) throw new AccesoContable("Entidad no disponible.", 404);
    const [bancos] = await c.query<RowDataPacket[]>(`SELECT b.id, c.id AS cuenta_id, c.codigo, c.nombre
      FROM cont_cuentas_bancarias b JOIN cont_cuentas c
        ON c.empresa_id=b.empresa_id AND c.entidad_id=b.entidad_id AND c.id=b.cuenta_id
      WHERE b.empresa_id=? AND b.entidad_id=? AND b.id=?`, [empresaId, entidadId, bancoId]);
    if (bancos.length !== 1) throw new AccesoContable("Cuenta bancaria contable no disponible.", 404);
    const b = bancos[0];
    const rows = await lineasMayor(c, empresaId, entidadId, Number(b.cuenta_id), filtros);
    return {
      procedencia: "LIBRO_MAYOR" as const, bancoId, entidadId,
      cuenta: { id: Number(b.cuenta_id), codigo: String(b.codigo), nombre: textoBanco(b.nombre) },
      desde: filtros.desde ?? null, hasta: filtros.hasta ?? null,
      movimientos: rows.map(r => ({ detalleId: Number(r.detalle_id), asientoId: Number(r.asiento_id),
        numero: textoBanco(r.numero), fecha: String(r.fecha), estado: ESTADO,
        debe: deCentavos(aCentavos(r.debe)), haber: deCentavos(aCentavos(r.haber)) })),
    };
  }, empresaId, entidadId, f);
}
