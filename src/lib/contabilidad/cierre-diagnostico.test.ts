import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const m=vi.hoisted(()=>({query:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),guard:vi.fn(),getConnection:vi.fn()}));
vi.mock('@/lib/db',()=>({getPool:()=>({getConnection:m.getConnection})}));
vi.mock('@/lib/tenant',()=>({requireTenantCalendario:m.guard}));
import {diagnosticarCierre,evaluarAsientos,type AsientoDiagnostico} from './cierre-diagnostico';
import {diagnosticoCierreGet} from './cierre-diagnostico-http';
import {ResultadoDiagnosticoCierre} from '@/components/contabilidad/cierre-diagnostico';
const asiento:AsientoDiagnostico={id:1,numero:'FICTICIO',fecha:'2030-01-01',estado:'Registrado',debe:'0.30',haber:'0.30',lineas:2,invalidas:0};
beforeEach(()=>{
 vi.resetAllMocks();m.getConnection.mockResolvedValue(m);m.guard.mockResolvedValue({empresa:{id:7},session:{id:41,rol:'Contabilidad'}});
 m.query.mockImplementation(async(sql:string)=>{
  if(sql.startsWith('SET ')||sql.startsWith('START '))return [[]];
  if(sql.includes('FROM cont_entidades'))return [[{id:9,codigo:'LAB',nombre:'Libro ficticio'}]];
  if(sql.includes('FROM cont_ejercicios'))return [[{id:1,codigo:'LAB2030',estado:'CONFIGURADO',fechaInicio:'2030-01-01',fechaFin:'2030-01-31'}]];
  if(sql.includes('FROM cont_periodos'))return [[{id:1,ejercicio_id:1,orden:1,codigo:'ENE',estado:'CERRADO',fechaInicio:'2030-01-01',fechaFin:'2030-01-31'}]];
  if(sql.includes('FROM cont_control_libro'))return [[{estado:'ACTIVO',version:2}]];
  if(sql.includes('GROUP BY a.id'))return [[asiento]];
  if(sql.includes('COUNT(*) total'))return [[{total:0}]];
  throw Error('SQL inesperado');
 });
});
describe('C3C5 aritmetica y contrato de solo lectura',()=>{
 it('detecta descuadres individuales aunque el neto global cuadre',()=>{
  const r=evaluarAsientos([{...asiento,debe:'0.10',haber:'0.20'},{...asiento,id:2,debe:'0.20',haber:'0.10'}]);
  expect(r.diferencia).toBe('0.00');expect(r.descuadrados.total).toBe(2);
 });
 it('distingue borradores, integridad y exactitud con importes grandes',()=>{
  const r=evaluarAsientos([{...asiento,debe:'99999999999999.99',haber:'99999999999999.98',invalidas:1},{...asiento,id:2,estado:'Borrador',debe:'999.00',haber:'0.00'}]);
  expect(r).toMatchObject({registrados:1,noRegistrados:1,diferencia:'0.01',integridad:{total:1},descuadrados:{total:1}});
 });
 it('no oculta totales al limitar las muestras',()=>{const r=evaluarAsientos(Array.from({length:105},(_,id)=>({...asiento,id,debe:'0.00',haber:'0.01',lineas:1})));expect(r.descuadrados.total).toBe(105);expect(r.descuadrados.muestra).toHaveLength(100);expect(r.integridad.total).toBe(105);});
 it('reutiliza reglas de calendario y devuelve fecha y advertencias sin certificar cierre',async()=>{
  const r=await diagnosticarCierre(7,9,1);expect(r.bloqueantes).toEqual([]);expect(r.estado).toBe('SIN_BLOQUEANTES_TECNICOS');expect(r.advertencias).toContain('REGULARIZACION_NO_VERIFICADA');expect(Date.parse(r.generadoEn)).not.toBeNaN();
  expect(m.query.mock.calls.slice(0,2).map(a=>a[0])).toEqual(['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ','START TRANSACTION READ ONLY']);
  expect(m.query.mock.calls.every(([sql])=>!(/FOR UPDATE|LOCK IN|INSERT|UPDATE |DELETE|ALTER|CREATE /i.test(sql)))).toBe(true);expect(m.commit).toHaveBeenCalledOnce();expect(m.release).toHaveBeenCalledOnce();
  const html=renderToStaticMarkup(createElement(ResultadoDiagnosticoCierre,{d:r}));expect(html).toContain('Bloqueantes');expect(html).toContain('Advertencias');expect(html).toContain('no autoriza');expect(html).toContain('CERRADO');expect(html).toContain(r.generadoEn);
 });
 it.each(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'])('control no disponible se informa como bloqueante: %s',async code=>{
  const original=m.query.getMockImplementation()!;m.query.mockImplementation((sql,...p)=>sql.includes('FROM cont_control_libro')?Promise.reject({code}):original(sql,...p));
  expect(await diagnosticarCierre(7,9,1)).toMatchObject({control:{disponible:false},bloqueantes:['CONTROL_NO_DISPONIBLE']});
 });
 it('error inesperado revierte y no produce resultado parcial',async()=>{m.query.mockRejectedValueOnce(Error('fallo'));await expect(diagnosticarCierre(7,9,1)).rejects.toThrow('fallo');expect(m.rollback).toHaveBeenCalledOnce();expect(m.commit).not.toHaveBeenCalled();expect(m.release).toHaveBeenCalledOnce();});
 it('libro ajeno no consulta ejercicios ni movimientos',async()=>{const original=m.query.getMockImplementation()!;m.query.mockImplementation((sql,...p)=>sql.includes('FROM cont_entidades')?Promise.resolve([[]]):original(sql,...p));await expect(diagnosticarCierre(8,9,1)).rejects.toMatchObject({status:404});expect(m.query.mock.calls.some(([sql])=>sql.includes('FROM cont_ejercicios'))).toBe(false);});
 it('ejercicio ajeno devuelve 404',async()=>{const original=m.query.getMockImplementation()!;m.query.mockImplementation((sql,...p)=>sql.includes('FROM cont_ejercicios')?Promise.resolve([[]]):original(sql,...p));await expect(diagnosticarCierre(7,9,2)).rejects.toMatchObject({status:404});});
 it.each([0,-1,1.5,2147483648])('identificador invalido %s no abre conexion',async id=>{await expect(diagnosticarCierre(7,9,id)).rejects.toMatchObject({status:400});expect(m.getConnection).not.toHaveBeenCalled();});
 it('HTTP exige permiso existente y no consulta sin autorizacion',async()=>{m.guard.mockResolvedValue({error:new Response(null,{status:403})});expect((await diagnosticoCierreGet(new Request('http://local?entidad=9'),'lab','1')).status).toBe(403);expect(m.guard).toHaveBeenCalledWith('lab','ver');expect(m.getConnection).not.toHaveBeenCalled();});
 it.each(['0','-1','x','2147483648'])('HTTP rechaza ejercicio invalido %s',async id=>{expect((await diagnosticoCierreGet(new Request('http://local?entidad=9'),'lab',id)).status).toBe(400);expect(m.getConnection).not.toHaveBeenCalled();});
 it.each(['','?entidad=9&entidad=10','?entidad=-1'])('HTTP rechaza entidad ambigua %s',async qs=>{expect((await diagnosticoCierreGet(new Request('http://local/'+qs),'lab','1')).status).toBe(400);});
 it('HTTP usa empresa autorizada e impide cache compartido',async()=>{const r=await diagnosticoCierreGet(new Request('http://local?entidad=9&empresa_id=8'),'lab','1');expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect((await r.json()).empresaId).toBe(7);expect(m.query.mock.calls.find(([sql])=>sql.includes('FROM cont_ejercicios'))?.[1]).toEqual([7,9,1]);});
});
