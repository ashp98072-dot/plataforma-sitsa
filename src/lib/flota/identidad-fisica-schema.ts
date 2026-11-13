import type { PoolConnection, RowDataPacket } from "mysql2/promise";
export const guardasFisicas=['fifi_nueva','fifm_validar','fifm_empresas','fifm_inmutable','fifm_no_borrar','fife_no_borrar','fife_inmutable','fifa_validar','fifa_inmutable','fifa_no_borrar','fifi_aprobar','fifi_no_borrar','fifv_identidad','ffi_2abd957034829d58fcc789b21f6ed7e4','ffu_2abd957034829d58fcc789b21f6ed7e4'];
export async function estadoEsquemaFisico(consulta:(sql:string,args?:string[])=>Promise<RowDataPacket[]>) {
 const t=await consulta("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_identidades_fisicas','flota_identidad_miembros','flota_identidad_empresas','flota_identidad_aprobaciones')");
 if(!t.length)return 'AUSENTE';
 const g=await consulta(`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (${guardasFisicas.map(()=>'?').join(',')})`,guardasFisicas);
 return t.length===4&&t.every(r=>r.ENGINE==='InnoDB')&&g.length===guardasFisicas.length?'COMPLETO':'PARCIAL';
}
export const consultaFisicaTx=(c:PoolConnection)=>(sql:string,args:string[]=[])=>c.query<RowDataPacket[]>(sql,args).then(r=>r[0]);
