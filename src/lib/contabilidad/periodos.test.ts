import {describe,it,expect,vi} from 'vitest';
import {accionPeriodo,exigirTransicion,motivoPeriodo} from './periodos-contrato';
import {comprobarPeriodoAsiento} from './periodos-control';
import {diagnosticoCalendario,evidenciaMovimientos,type PeriodoControl,type MovimientoPeriodo} from './periodos-evidencia';
import type {PoolConnection} from 'mysql2/promise';
const p={id:1,ejercicio_id:1,orden:1,codigo:'P',fechaInicio:'2030-01-01',fechaFin:'2030-12-31',inicioEjercicio:'2030-01-01',finEjercicio:'2030-12-31',estado:'ABIERTO',version:0,revision_cierre:0} satisfies PeriodoControl;
const rows:MovimientoPeriodo[]=[{asiento:1,detalle:1,cuenta:1,fecha:'2030-01-01',estado:'Registrado',debe:'1.00',haber:'0.00',ambitoValido:1},{asiento:1,detalle:2,cuenta:2,fecha:'2030-01-01',estado:'Registrado',debe:'0.00',haber:'1.00',ambitoValido:1}];
describe('C3C2 contratos y evidencia pura',()=>{
  it('admite solo transiciones dirigidas',()=>{
    exigirTransicion('CONFIGURADO','abrir');exigirTransicion('ABIERTO','cerrar');exigirTransicion('CERRADO','reabrir');
    for(const [estado,accion] of [['CERRADO','abrir'],['CONFIGURADO','cerrar'],['ABIERTO','reabrir']] as const)expect(()=>exigirTransicion(estado,accion)).toThrow();
  });
  it('valida motivo y rechaza autoridad inyectada',()=>{
    for(const m of ['x',' '.repeat(30),'a'.repeat(1001),'a'.repeat(21)+'\u200b'])expect(motivoPeriodo.safeParse(m).success).toBe(false);
    expect(accionPeriodo.safeParse({accion:'abrir',periodoId:1,version:0,motivo:'Motivo ficticio suficientemente largo',operacion:crypto.randomUUID(),actorId:1}).success).toBe(false);
  });
  it('comprueba todos los asientos, no solo cuadre global; preserva evidencia exacta',()=>{
    expect(evidenciaMovimientos(rows)).toMatchObject({asientos:1,lineas:2,debeCentavos:'100'});
    expect(()=>evidenciaMovimientos(rows.map((r,i)=>({...r,asiento:i+1})))).toThrow();
    expect(()=>evidenciaMovimientos([{...rows[0],ambitoValido:0},rows[1]])).toThrow();
    expect(()=>evidenciaMovimientos([{...rows[0],debe:'1.001'},rows[1]])).toThrow();
  });
  it('separa historia sin cobertura de solapamiento bloqueante',()=>{
    expect(diagnosticoCalendario([p],rows).bloqueantes).toEqual([]);
    expect(diagnosticoCalendario([p],rows.map(r=>({...r,fecha:'2029-01-01'}))).advertencias).toContain('HISTORIA_SIN_COBERTURA');
    expect(diagnosticoCalendario([p,{...p,id:2,ejercicio_id:2}],rows).bloqueantes).toContain('SOLAPAMIENTO');
  });
});
describe('Control central con conexión simulada, sin bases reales',()=>{
  function connection(estado:string,periodos:unknown[]){return {execute:vi.fn().mockResolvedValue([{affectedRows:1}]),query:vi.fn().mockResolvedValueOnce([[{estado}]]).mockResolvedValueOnce([periodos])};}
  it.each(['CONFIGURADO','CERRADO'])('rechaza %s antes de modificar contador',async estado=>{
    const c=connection('ACTIVO',[{id:1,estado}]);await expect(comprobarPeriodoAsiento(c as unknown as PoolConnection,7,9,'2030-01-01')).rejects.toMatchObject({codigo:'PERIODO_NO_ABIERTO'});
    expect(c.execute).toHaveBeenCalledTimes(1);
  });
  it('permite abierto y acota fechas/empresa/libro en la consulta',async()=>{
    const c=connection('ACTIVO',[{id:1,estado:'ABIERTO'}]);await comprobarPeriodoAsiento(c as unknown as PoolConnection,7,9,'2030-01-01');
    expect(c.query.mock.calls[1][1]).toEqual([7,9,'2030-01-01','2030-01-01']);expect(c.execute).toHaveBeenCalledTimes(2);
  });
  it.each([{periodos:[]},{periodos:[{id:1,estado:'ABIERTO'},{id:2,estado:'ABIERTO'}]}])('rechaza cobertura no única',async({periodos})=>{
    const c=connection('ACTIVO',periodos);await expect(comprobarPeriodoAsiento(c as unknown as PoolConnection,7,9,'2030-01-01')).rejects.toMatchObject({codigo:'PERIODO_AMBIGUO'});
  });
  it('modo desactivado no consulta ni altera historia; sí invalida diagnóstico',async()=>{
    const c=connection('NO_ACTIVADO',[]);await comprobarPeriodoAsiento(c as unknown as PoolConnection,7,9,'2030-01-01');expect(c.query).toHaveBeenCalledOnce();expect(c.execute.mock.calls[1][0]).toContain('cambios=cambios+1');
  });
});
