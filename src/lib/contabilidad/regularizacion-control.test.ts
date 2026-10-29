import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {ZodError} from 'zod';
import {huellaCondiciones,identificarOrigen,type AsientoOrigen,type MetadatoOrigen} from './regularizacion-control-contrato';
const m=vi.hoisted(()=>({guard:vi.fn(),get:vi.fn(),save:vi.fn(),tag:vi.fn()}));
vi.mock('@/lib/tenant',()=>({requireTenantCalendario:m.guard}));
vi.mock('./regularizacion-control',()=>({consultarPreparacion:m.get,guardarPreparacion:m.save,registrarOrigenDocumentado:m.tag}));
import {preparacionHttp} from './regularizacion-control-http';
import {AccesoContable} from './ambito';
import type {PreparacionRegularizacion} from './regularizacion-control';
import {ResultadoPreparacion} from '@/components/contabilidad/regularizacion-control';
const asiento:AsientoOrigen={id:1,fecha:'2030-01-01',numero:'CIERRE-RESULTADO',estado:'Registrado',glosa:'Regularizacion por nombre no demuestra origen',creadoPor:'lab',lineas:[{id:1,cuentaId:1,debe:'10.00',haber:'0.00'},{id:2,cuentaId:2,debe:'0.00',haber:'10.00'}]};
const metadata=(a=asiento):MetadatoOrigen=>({asientoId:1,ejercicioId:1,clase:'REGULARIZACION',fuente:'REVISION_DOCUMENTADA',referencia:'Documento ficticio revisado',huella:huellaCondiciones(a),registradoPor:41});
beforeEach(()=>{vi.resetAllMocks();m.guard.mockResolvedValue({empresa:{id:7},session:{id:41,username:'lab',rol:'Contabilidad'}});m.get.mockResolvedValue({aprobado:false,contabilizado:false});m.save.mockResolvedValue({version:1,estado:'BORRADOR'});m.tag.mockResolvedValue({registrado:true});});
describe('C3C9 contrato y procedencia',()=>{
 it('huella estable por claves y sensible a condiciones y orden de movimientos',()=>{expect(huellaCondiciones({a:1,b:2})).toBe(huellaCondiciones({b:2,a:1}));expect(huellaCondiciones([1,2])).not.toBe(huellaCondiciones([2,1]));expect(huellaCondiciones({...asiento,estado:'Borrador'})).not.toBe(huellaCondiciones(asiento));});
 it('historia sin metadatos es NO VERIFICADA, no NORMAL ni regularizacion por nombre',()=>expect(identificarOrigen(asiento,[],1,9).origen).toBe('NO_VERIFICADO'));
 it('cuenta resultado solo es indicio aun con neto cero',()=>{const a={...asiento,lineas:[{id:1,cuentaId:9,debe:'10.00',haber:'0.00'},{id:2,cuentaId:9,debe:'0.00',haber:'10.00'}]};expect(identificarOrigen(a,[],1,9).origen).toBe('INDICIO');});
 it.each(['REGULARIZACION','NORMAL'])('metadato explicito documentado identifica %s',clase=>{const r=identificarOrigen(asiento,[{...metadata(),clase}],1,9);expect(r.origen).toBe(clase==='NORMAL'?'NORMAL_IDENTIFICADO':'REGULARIZACION_IDENTIFICADA');expect(r.evidencia?.referencia).toBeTruthy();});
 it('emision controlada tiene soporte sin inferencias',()=>expect(identificarOrigen(asiento,[{...metadata(),fuente:'EMISION_CONTROLADA'}],1,9).origen).toBe('REGULARIZACION_IDENTIFICADA'));
 it.each([{huella:'0'.repeat(64)},{ejercicioId:2},{fuente:'NOMBRE_CUENTA'},{referencia:''},{registradoPor:0}])('evidencia incompatible no certifica origen %j',patch=>{const r=identificarOrigen(asiento,[{...metadata(),...patch}],1,9);expect(r.origen).toBe('NO_VERIFICADO');expect(r.metadatoInvalido).toBe(true);});
 it('metadatos duplicados y asiento alterado no verifican procedencia',()=>{expect(identificarOrigen(asiento,[metadata(),metadata()],1,9).metadatoInvalido).toBe(true);expect(identificarOrigen({...asiento,glosa:'otra'},[metadata()],1,9).metadatoInvalido).toBe(true);});
 it('borrador contable no adquiere procedencia registrada',()=>{const a={...asiento,estado:'Borrador'};expect(identificarOrigen(a,[metadata(a)],1,9).origen).toBe('NO_VERIFICADO');});
});
describe('C3C9 HTTP',()=>{
 it.each([false,true])('permiso lectura es requisito previo, guardar=%s',async guardar=>{m.guard.mockResolvedValue({error:new Response(null,{status:403})});const r=await preparacionHttp(new Request('http://local?entidad=9'),'lab','1',guardar);expect(r.status).toBe(403);expect(m.get).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();expect(r.headers.get('Cache-Control')).toBe('private, no-store');});
 it.each(['0','abc','2147483648'])('ejercicio invalido %s',async id=>expect((await preparacionHttp(new Request('http://local?entidad=9'),'lab',id)).status).toBe(400));
 it.each(['','?entidad=0','?entidad=9&entidad=10'])('libro ambiguo/invalido %s',async query=>expect((await preparacionHttp(new Request('http://local/'+query),'lab','1')).status).toBe(400));
 it('GET deriva empresa de sesion e ignora aprobaciones aportadas',async()=>{const r=await preparacionHttp(new Request('http://local?entidad=9&empresa_id=8&aprobado=true'),'lab','1');expect(r.status).toBe(200);expect(m.get).toHaveBeenCalledWith(7,9,1,41);expect(m.guard).toHaveBeenCalledWith('lab','ver');expect(r.headers.get('Cache-Control')).toBe('private, no-store');});
 it('POST delega autorizacion especifica al servicio y no admite bypass Admin en helper',async()=>{m.save.mockRejectedValue(new AccesoContable('Sin permiso',403));const r=await preparacionHttp(new Request('http://local?entidad=9',{method:'POST',body:'{}'}),'lab','1',true);expect(r.status).toBe(403);expect(m.save).toHaveBeenCalledWith(7,9,1,{id:41,username:'lab'},{});});
 it('endpoint documental separado delega actor y ambito',async()=>{await preparacionHttp(new Request('http://local?entidad=9',{method:'POST',body:'{}'}),'lab','1',true,true);expect(m.tag).toHaveBeenCalledWith(7,9,1,{id:41,username:'lab'},{});expect(m.save).not.toHaveBeenCalled();});
 it('validacion 400, conflicto 409 y falta de esquema 503 sin detalles internos',async()=>{for(const [error,status] of [[new ZodError([]),400],[new AccesoContable('Cambió',409),409],[{code:'ER_NO_SUCH_TABLE'},503]] as const){m.save.mockRejectedValue(error);const r=await preparacionHttp(new Request('http://local?entidad=9',{method:'POST',body:'{}'}),'lab','1',true);expect(r.status).toBe(status);expect(r.headers.get('Cache-Control')).toBe('private, no-store');}});
});
it('presentacion distingue preparacion, aprobacion, origen y contabilizacion sin acciones reales',()=>{
 const d={empresaId:7,entidadId:9,ejercicioId:1,ejercicio:{codigo:'LAB'},generadoEn:'2030-01-01',aviso:'PREPARACIÓN TÉCNICA — NO APROBADA NI CONTABILIZADA',estadoPreparacion:'CON_BLOQUEANTES',politica:{contrato:'C3C9-PREP-1',version:1,base:'C3C8-SIM-1',huellaCondiciones:'a'.repeat(64),tratamiento:'Inversas',cuentaResultado:null,idoneidad:{tecnica:'NO_CONFIGURADA',formal:'PENDIENTE'},cuentasNominales:[]},resumen:{ingresos:'1.00',gastos:'0.00',resultadoPreliminar:'1.00'},bloqueantes:['CUENTA_RESULTADO_NO_CONFIGURADA'],pendientesFormales:['POLITICA_REGULARIZACION_PENDIENTE'],origenes:[identificarOrigen(asiento,[],1,9)],revisiones:[]} as unknown as PreparacionRegularizacion;
 const html=renderToStaticMarkup(createElement(ResultadoPreparacion,{d}));expect(html).toContain('Aprobación formal: NO');expect(html).toContain('Contabilización: NO');expect(html).toContain('NO_VERIFICADO');expect(html).not.toContain('<button');expect(html).not.toContain('<form');
});
