import ExcelJS from 'exceljs';
import type {InformePrecontable} from './precontable';

/** Reutiliza ExcelJS, ya empleado en exportaciones del ERP. Sin fórmulas aportadas por usuarios. */
export async function precontableAExcel(d:InformePrecontable):Promise<Buffer>{
 const wb=new ExcelJS.Workbook();
 const resumen=wb.addWorksheet('Revision precontable');
 resumen.columns=[{width:32},{width:95}];
 resumen.addRows([
  ['INFORME PRECONTABLE','ESTADO FORMAL PENDIENTE'],['Aviso',d.aviso],
  ['Empresa / libro / ejercicio',`${d.empresaId} / ${d.entidadId} / ${d.ejercicioId}`],
  ['Solicitud',d.solicitudId],['Evaluado en',d.evaluadoEn],['Huella integral',d.huellaIntegral],
  ['Vigencia','Instantánea: reconsultar condiciones antes de su revisión.'],
  ['DATOS ORIGINALES','Movimientos registrados; historia anterior separada.'],
  ['Ingresos del ejercicio',d.originales.saldos.ingresos],['Gastos del ejercicio',d.originales.saldos.gastos],
  ['Resultado preliminar',d.originales.saldos.resultadoPreliminar],
  ['PROPUESTA SIMULADA','No contabilizada. No constituye aprobación.'],
  ['Estado técnico',d.completoTecnicamente?'COMPLETO TECNICAMENTE':'CON BLOQUEANTES'],
 ]);
 const cuentas=wb.addWorksheet('Saldos originales');
 cuentas.addRow(['Cuenta','Nombre','Tipo','Debe ejercicio','Haber ejercicio','Saldo ejercicio','Saldo histórico anterior']);
 for(const c of d.originales.saldos.nominales)cuentas.addRow([c.codigo,c.nombre,c.tipo,c.debe,c.haber,c.saldoEjercicio,c.saldoHistoricoAnterior]);
 const propuesta=wb.addWorksheet('Propuesta simulada');
 propuesta.addRow(['NO CONTABILIZADA - NO APROBADA']);
 propuesta.addRow(['Cuenta','Nombre','Origen','Debe simulado','Haber simulado']);
 for(const c of d.simulacion.propuesta?.lineas??[])propuesta.addRow([c.codigo,c.nombre,c.origen,c.debe,c.haber]);
 const hallazgos=wb.addWorksheet('Diagnostico');
 hallazgos.addRow(['Nivel','Código','Referencias']);
 for(const h of d.hallazgos)hallazgos.addRow([h.nivel,h.codigo,JSON.stringify(h.referencias)]);
 const evidencia=wb.addWorksheet('Evidencias y decisiones');
 evidencia.addRow(['Tipo','Referencia','Versión','Estado / acción','Actor','Fecha','Huella / justificación']);
 for(const e of d.expediente.evidencias)evidencia.addRow(['EVIDENCIA',e.codigo,e.version,e.estado,e.creadoPor,e.creadoEn,`${e.huellaDocumento??''} | ${e.justificacion}`]);
 for(const e of d.expediente.solicitud.historial)evidencia.addRow(['DECISION',d.solicitudId,e.version,e.accion,e.creadoPor,e.creadoEn,e.justificacion]);
 evidencia.addRow(['RESPONSABLES',JSON.stringify(d.expediente.solicitud.politica?.responsables)]);
 for(const ws of wb.worksheets){
  ws.views=[{state:'frozen',ySplit:1}];ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF16324F'}};
  if(ws!==resumen)ws.columns.forEach(c=>{c.width=28;});
  ws.eachRow(r=>{r.alignment={vertical:'top',wrapText:true};});
 }
 return Buffer.from(await wb.xlsx.writeBuffer());
}
