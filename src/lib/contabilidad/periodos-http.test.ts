import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({guard:vi.fn(),operar:vi.fn(),consultar:vi.fn(),evidencia:vi.fn()}));
vi.mock('@/lib/tenant',()=>({requireTenantCalendario:m.guard}));
vi.mock('@/lib/db',()=>({getPool:()=>{throw Error('BD real prohibida');}}));
vi.mock('./periodos',()=>({operarPeriodo:m.operar,consultarControlPeriodo:m.consultar,consultarEvidenciaPeriodo:m.evidencia}));
import {controlPeriodosHttp} from './periodos-http';import {ErrorPeriodo} from './periodos-contrato';
beforeEach(()=>{vi.resetAllMocks();m.guard.mockResolvedValue({empresa:{id:7},session:{id:41,username:'ficticio'}});m.consultar.mockResolvedValue({});m.operar.mockResolvedValue({estado:'ABIERTO'});});
describe('C3C2 HTTP: autenticación, ámbitos y errores',()=>{
  it.each([401,403])('sin acceso %s no ejecuta servicios',async status=>{
    m.guard.mockResolvedValue({error:new Response(null,{status})});
    expect((await controlPeriodosHttp(new Request('http://local?entidad=9'),'lab',true)).status).toBe(status);expect(m.operar).not.toHaveBeenCalled();
  });
  it('usa actor y empresa del guard, valida entidad duplicada',async()=>{
    const req=new Request('http://local?entidad=9',{method:'POST',body:'{}'});await controlPeriodosHttp(req,'lab',true);
    expect(m.operar.mock.calls[0][0]).toEqual({empresaId:7,entidadId:9,actor:{id:41,username:'ficticio'}});
    expect((await controlPeriodosHttp(new Request('http://local?entidad=9&entidad=10'),'lab')).status).toBe(400);
  });
  it('expone evidencia solo con ámbito validado',async()=>{
    m.evidencia.mockResolvedValue({id:2});await controlPeriodosHttp(new Request('http://local?entidad=9&cierre=2'),'lab');
    expect(m.evidencia).toHaveBeenCalledWith(7,9,2);
  });
  it('conserva conflicto funcional y oculta SQL/token inesperados',async()=>{
    m.operar.mockRejectedValue(new ErrorPeriodo('PERIODO_NO_ABIERTO','Período no abierto.'));
    const req=()=>new Request('http://local?entidad=9',{method:'POST',body:'{}'});
    expect((await controlPeriodosHttp(req(),'lab',true)).status).toBe(409);
    m.operar.mockRejectedValue({sql:'SECRET_SQL',message:'SECRET_TOKEN'});const spy=vi.spyOn(console,'error').mockImplementation(()=>{});
    try{const r=await controlPeriodosHttp(req(),'lab',true);expect(r.status).toBe(500);const text=await r.text();expect(text+JSON.stringify(spy.mock.calls)).not.toContain('SECRET');}finally{spy.mockRestore();}
  });
});
