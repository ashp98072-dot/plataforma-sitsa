import {beforeEach,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ZodError} from 'zod';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PrecontablePanel} from '@/components/contabilidad/precontable';
import {constanciaEntrada,componentesCambiados,permisoConstancia} from './precontable-contrato';
const m=vi.hoisted(()=>({guard:vi.fn(),get:vi.fn(),save:vi.fn(),excel:vi.fn()}));
vi.mock('@/lib/tenant',()=>({requireTenantCalendario:m.guard}));
vi.mock('./precontable',()=>({consultarPrecontable:m.get,registrarConstancia:m.save}));
vi.mock('./precontable-excel',()=>({precontableAExcel:m.excel}));
import {precontableHttp} from './precontable-http';
import {AccesoContable} from './ambito';

const entrada={solicitudId:'1',versionEsperada:0,huellaIntegral:'a'.repeat(64),justificacion:'Evaluación técnica documentada sin aprobación',claveIdempotencia:randomUUID(),confirmacion:'CONSTANCIA_TECNICA_SIN_APROBACION_FORMAL'};
describe('C3C13 contratos',()=>{
 it('contrato estricto e idempotencia normalizada',()=>{expect(constanciaEntrada.parse({...entrada,claveIdempotencia:entrada.claveIdempotencia.toUpperCase()}).claveIdempotencia).toBe(entrada.claveIdempotencia);});
 it.each([{aprobado:true},{empresaId:8},{contabilizar:true},{accion:'APROBAR'},{confirmacion:'APROBACION_FORMAL'},{versionEsperada:-1},{huellaIntegral:'abc'},{justificacion:'corta'},{solicitudId:'0'}])('rechaza autoridad o campos fuera del contrato %j',patch=>{expect(constanciaEntrada.safeParse({...entrada,...patch}).success).toBe(false);});
 it('compara componentes incluso eliminados o añadidos',()=>{expect(componentesCambiados({a:'1',b:'2'},{b:'3',c:'4'})).toEqual(['a','b','c']);expect(componentesCambiados({a:'1'},{a:'1'})).toEqual([]);});
 it('solo revisor distinto de preparador y responsables elegibles',()=>{const roles={preparadorId:41,revisorId:42,resolutorId:44};expect(permisoConstancia(42,roles,[41,42,44])).toBe(true);for(const actor of [41,44,45])expect(permisoConstancia(actor,roles,[41,42,44])).toBe(false);expect(permisoConstancia(42,roles,[41,42])).toBe(false);expect(permisoConstancia(42,{...roles,preparadorId:42},[41,42,44])).toBe(false);expect(permisoConstancia(42,undefined,[41,42,44])).toBe(false);});
});
beforeEach(()=>{vi.resetAllMocks();m.guard.mockResolvedValue({empresa:{id:7},session:{id:42,username:'revisor'}});m.get.mockResolvedValue({evaluaciones:[{informe:{solicitudId:'1'}}]});m.save.mockResolvedValue({version:1,reutilizado:false,aprobacionFormal:false});m.excel.mockResolvedValue(Buffer.from('xlsx'));});
describe('C3C13 HTTP',()=>{
 it('deriva tenant y actor del guard, cabeceras privadas',async()=>{const r=await precontableHttp(new Request('http://local?entidad=9&empresa_id=8'),'lab','2');expect(r.status).toBe(200);expect(m.get).toHaveBeenCalledWith(7,9,2,42);expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');});
 it('POST delega permiso, contrato y concurrencia a transaccion',async()=>{const r=await precontableHttp(new Request('http://local?entidad=9',{method:'POST',body:JSON.stringify(entrada)}),'lab','2',true);expect(r.status).toBe(200);expect(m.save).toHaveBeenCalledWith(7,9,2,{id:42,username:'revisor'},entrada);});
 it.each([['http://local?entidad=9&entidad=10','2'],['http://local?entidad=9','0'],['http://local?entidad=9','2147483648'],['http://local?entidad=9&formato=pdf','2'],['http://local?entidad=9&formato=xlsx','2'],['http://local?entidad=9&formato=xlsx&solicitud=1&solicitud=2','2']])('rechaza ámbito/formato ambiguo %s',async(url,id)=>{expect((await precontableHttp(new Request(url),'lab',id)).status).toBe(400);expect(m.get).not.toHaveBeenCalled();});
 it('guard denegado no lee ni escribe',async()=>{m.guard.mockResolvedValue({error:new Response('{}',{status:403})});expect((await precontableHttp(new Request('http://local?entidad=9'),'lab','2')).status).toBe(403);expect(m.get).not.toHaveBeenCalled();});
 it.each([[new ZodError([]),400],[new AccesoContable('Conflicto',409),409],[{code:'ER_NO_SUCH_TABLE'},503],[new Error('detalle privado'),500]])('errores controlados %j',async(error,status)=>{m.get.mockRejectedValue(error);const r=await precontableHttp(new Request('http://local?entidad=9'),'lab','2');expect(r.status).toBe(status);expect(await r.text()).not.toContain('detalle privado');});
 it('Excel limitado a solicitud del ámbito y nombre seguro',async()=>{const r=await precontableHttp(new Request('http://local?entidad=9&formato=xlsx&solicitud=1'),'lab','2');expect(r.status).toBe(200);expect(r.headers.get('Content-Disposition')).toContain('precontable-1.xlsx');expect(m.excel).toHaveBeenCalledWith({solicitudId:'1'});expect((await precontableHttp(new Request('http://local?entidad=9&formato=xlsx&solicitud=2'),'lab','2')).status).toBe(404);});
 it('interfaz inicial no ofrece aprobación formal',()=>{const html=renderToStaticMarkup(createElement(PrecontablePanel,{slug:'lab',entidadId:9,ejercicioId:'2'}));expect(html).toContain('Validación integral');expect(html).toContain('Evaluar / actualizar condiciones');expect(html).not.toMatch(/<button[^>]*>Aprobar/);});
});
