import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {ZodError} from 'zod';
import {ExpedientesPanel} from '@/components/contabilidad/expedientes';
const m=vi.hoisted(()=>({guard:vi.fn(),get:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/tenant',()=>({requireTenantCalendario:m.guard}));
vi.mock('./expediente',()=>({consultarExpedientes:m.get,registrarEvidencia:m.save}));
import {expedienteHttp} from './expediente-http';
beforeEach(()=>{vi.resetAllMocks();m.guard.mockResolvedValue({empresa:{id:7},session:{id:41,username:'lab'}});m.get.mockResolvedValue({expedientes:[]});m.save.mockResolvedValue({reutilizado:false});});
describe('C3C12 HTTP e interfaz',()=>{
 it('deriva empresa y actor del guard, no del cliente',async()=>{const r=await expedienteHttp(new Request('http://local?entidad=9&empresa_id=8'),'lab','2');expect(r.status).toBe(200);expect(m.get).toHaveBeenCalledWith(7,9,2,41);expect(r.headers.get('Cache-Control')).toBe('private, no-store');});
 it('POST delega permisos y contrato al servicio transaccional',async()=>{await expedienteHttp(new Request('http://local?entidad=9',{method:'POST',body:JSON.stringify({solicitudId:'1'})}),'lab','2',true);expect(m.save).toHaveBeenCalledWith(7,9,2,{id:41,username:'lab'},{solicitudId:'1'});});
 it('rechaza ambitos ambiguos y ejercicio invalido',async()=>{for(const [url,id] of [['http://local?entidad=9&entidad=10','2'],['http://local?entidad=9','0']])expect((await expedienteHttp(new Request(url),'lab',id)).status).toBe(400);expect(m.get).not.toHaveBeenCalled();});
 it('rechazo del guard no lee expediente',async()=>{m.guard.mockResolvedValue({error:new Response('{}',{status:403})});expect((await expedienteHttp(new Request('http://local?entidad=9'),'lab','2')).status).toBe(403);expect(m.get).not.toHaveBeenCalled();});
 it('errores de contrato y migracion son explicitos',async()=>{m.get.mockRejectedValue(new ZodError([]));expect((await expedienteHttp(new Request('http://local?entidad=9'),'lab','2')).status).toBe(400);m.get.mockRejectedValue({code:'ER_NO_SUCH_TABLE'});expect((await expedienteHttp(new Request('http://local?entidad=9'),'lab','2')).status).toBe(503);});
 it('interfaz accesible no ofrece aprobacion formal',()=>{const html=renderToStaticMarkup(createElement(ExpedientesPanel,{slug:'lab',entidadId:9,ejercicioId:'2'}));expect(html).toContain('Expedientes C3C-12');expect(html).toContain('Consultar expedientes');expect(html).not.toMatch(/<button[^>]*>Aprobar/);});
});
