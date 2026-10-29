import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),guard:vi.fn()}));
vi.mock('@/lib/db',()=>({getPool:()=>({getConnection:async()=>m})}));
vi.mock('@/lib/tenant',()=>({requireTenantCalendario:m.guard}));
import {cuentaResultadoElegible,consultarCuentaResultadoTx,guardarCuentaResultado} from './cuenta-resultado';
import {cuentaResultadoHttp} from './cuenta-resultado-http';
import type {PoolConnection} from 'mysql2/promise';
beforeEach(()=>{vi.resetAllMocks();m.guard.mockResolvedValue({empresa:{id:7},session:{id:41,username:'lab-41'}});m.query.mockResolvedValue([[]]);});
it.each(['Ingreso','Gasto','Activo','Pasivo','Otro','capital'])('rechaza tipo incompatible %s',tipo=>expect(cuentaResultadoElegible({tipo,activa:1})).toBe(false));
it('solo Capital activa es elegible, sin inferir por codigo/nombre o nivel',()=>{expect(cuentaResultadoElegible({tipo:'Capital',activa:1,nivel:1})).toBe(true);expect(cuentaResultadoElegible({tipo:'Capital',activa:0})).toBe(false);expect(cuentaResultadoElegible({tipo:'Gasto',activa:1,codigo:'RESULTADO'})).toBe(false);});
it('no configurada conserva null y no escribe',async()=>{expect(await consultarCuentaResultadoTx(m as unknown as PoolConnection,7,9)).toEqual({cuenta:null,estado:'NO_CONFIGURADA'});expect(m.execute).not.toHaveBeenCalled();expect(m.query.mock.calls[0][1]).toEqual([7,9,'RESULTADO_EJERCICIO']);expect(m.query.mock.calls[0][0]).not.toContain('FOR UPDATE');});
it('cuenta valida se informa con su nivel sin certificar imputabilidad',async()=>{m.query.mockResolvedValue([[{id:5,codigo:'RES',nombre:'Ficticia',tipo:'Capital',activa:1,rol_activo:1,nivel:4}]]);expect(await consultarCuentaResultadoTx(m as unknown as PoolConnection,7,9)).toMatchObject({estado:'VALIDADA_TECNICAMENTE',cuenta:{id:5,nivel:4}});});
it.each([{id:5,tipo:'Ingreso',activa:1,rol_activo:1},{id:5,tipo:'Capital',activa:0,rol_activo:1},{id:null},{id:5,tipo:'Capital',activa:1,rol_activo:0}])('configuracion invalida se rechaza: %j',async row=>{m.query.mockResolvedValue([[row]]);expect((await consultarCuentaResultadoTx(m as unknown as PoolConnection,7,9)).estado).toBe('INVALIDA');});
it('esquema ausente no se instala ni se confunde con cuenta valida',async()=>{m.query.mockRejectedValue({code:'ER_NO_SUCH_TABLE'});expect((await consultarCuentaResultadoTx(m as unknown as PoolConnection,7,9)).estado).toBe('ESQUEMA_NO_DISPONIBLE');expect(m.execute).not.toHaveBeenCalled();});
it('error inesperado no se oculta como falta de configuracion',async()=>{m.query.mockRejectedValue(Error('fallo'));await expect(consultarCuentaResultadoTx(m as unknown as PoolConnection,7,9)).rejects.toThrow('fallo');});
it('guard HTTP no permite lectura ni escritura sin permiso de consulta',async()=>{m.guard.mockResolvedValue({error:new Response(null,{status:403})});expect((await cuentaResultadoHttp(new Request('http://lab?entidad=9'),'lab')).status).toBe(403);expect(m.query).not.toHaveBeenCalled();});
it('HTTP rechaza cuerpo extra, cuenta invalida y entidad duplicada',async()=>{
 for(const body of [{cuentaId:0,cuentaAnteriorId:null},{cuentaId:5,cuentaAnteriorId:null,empresaId:8}])expect((await cuentaResultadoHttp(new Request('http://lab?entidad=9',{method:'PUT',body:JSON.stringify(body)}),'lab',true)).status).toBe(400);
 expect((await cuentaResultadoHttp(new Request('http://lab?entidad=9&entidad=10'),'lab')).status).toBe(400);expect(m.execute).not.toHaveBeenCalled();
});
it('fallo de escritura hace rollback sin commit',async()=>{m.query.mockRejectedValue(Error('fallo'));await expect(guardarCuentaResultado(7,9,{id:41,username:'lab'},5,null)).rejects.toThrow();expect(m.rollback).toHaveBeenCalledOnce();expect(m.commit).not.toHaveBeenCalled();expect(m.release).toHaveBeenCalledOnce();});
it('si falla auditoria la configuracion no se confirma',async()=>{
 m.query.mockResolvedValueOnce([[{id:7}]]).mockResolvedValueOnce([[{id:9,activa:1}]]).mockResolvedValueOnce([[{id:41}]]).mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{id:5,tipo:'Capital',activa:1}]]);
 m.execute.mockResolvedValueOnce([{}]).mockRejectedValueOnce(Error('audit'));await expect(guardarCuentaResultado(7,9,{id:41,username:'lab'},5,null)).rejects.toThrow('audit');expect(m.rollback).toHaveBeenCalledOnce();expect(m.commit).not.toHaveBeenCalled();
});
