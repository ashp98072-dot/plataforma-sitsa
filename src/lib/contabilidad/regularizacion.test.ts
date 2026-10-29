import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {calcularRegularizacion,type CuentaSimulacion} from './regularizacion-calculo';
const m=vi.hoisted(()=>({query:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),getConnection:vi.fn(),diagnostico:vi.fn(),guard:vi.fn()}));
vi.mock('@/lib/db',()=>({getPool:()=>({getConnection:m.getConnection})}));
vi.mock('./cierre-diagnostico',()=>({consultarDiagnosticoCierre:m.diagnostico}));
vi.mock('@/lib/tenant',()=>({requireTenantCalendario:m.guard}));
import {simularRegularizacion} from './regularizacion';import {regularizacionGet} from './regularizacion-http';
import {ResultadoRegularizacion} from '@/components/contabilidad/regularizacion-simulacion';
const cuenta=(tipo:string,debe='0.00',haber='0.00',id=1):CuentaSimulacion=>({cuentaId:id,codigo:String(id),nombre:'Ficticia',tipo,activa:1,debe,haber,debeAnterior:'999.00',haberAnterior:'0.00'});
beforeEach(()=>{
 vi.resetAllMocks();m.getConnection.mockResolvedValue(m);m.guard.mockResolvedValue({empresa:{id:7},session:{id:41,rol:'Contabilidad'}});
 m.diagnostico.mockResolvedValue({ejercicio:{id:1,codigo:'LAB2030',fechaInicio:'2030-01-01',fechaFin:'2030-12-31'},bloqueantes:[],advertencias:[],periodos:[],abiertos:[],noCerrados:[],control:{disponible:true,estado:'ACTIVO'},asientos:{registrados:0,noRegistrados:0,debe:'0.00',haber:'0.00',diferencia:'0.00',descuadrados:{total:0,muestra:[]},integridad:{total:0,muestra:[]}},generadoEn:'2030-01-01T00:00:00Z'});
 m.query.mockImplementation(async(sql:string)=>sql.includes('FROM cont_cuentas')?[[{id:1,codigo:'1',nombre:'Ingreso ficticio',tipo:'Ingreso',activa:1}]]:[[]]);
});
describe('C3C6 calculo puro',()=>{
 it.each([['100.00','40.00','60.00'],['40.00','100.00','-60.00']])('ingreso %s gasto %s resultado %s', (ingreso,gasto,resultado)=>{
  const r=calcularRegularizacion([cuenta('Ingreso','0.00',ingreso),cuenta('Gasto',gasto,'0.00',2)]);expect(r.resultadoPreliminar).toBe(resultado);expect(r.nominales[0].inversaIndicativa).toEqual({debe:ingreso,haber:'0.00'});expect(r.nominales[1].inversaIndicativa).toEqual({debe:'0.00',haber:gasto});
 });
 it('saldos contrarios conservan signo e invierten la columna correcta',()=>{
  const r=calcularRegularizacion([cuenta('Ingreso','0.30'),cuenta('Gasto','0.00','0.10',2)]);expect(r).toMatchObject({ingresos:'-0.30',gastos:'-0.10',resultadoPreliminar:'-0.20',saldosContrarios:[1,2]});expect(r.nominales[0].inversaIndicativa.haber).toBe('0.30');expect(r.nominales[1].inversaIndicativa.debe).toBe('0.10');
 });
 it('historico separado y cuentas sin movimientos no alteran el resultado',()=>{const r=calcularRegularizacion([cuenta('Ingreso')]);expect(r.resultadoPreliminar).toBe('0.00');expect(r.nominales[0]).toMatchObject({saldoHistoricoAnterior:'999.00',saldoEjercicio:'0.00',inversaIndicativa:{debe:'0.00',haber:'0.00'}});});
 it('no infiere clasificaciones ni cuentas de resultado por codigo o nombre',()=>{const c={...cuenta('Otro'),codigo:'RESULTADO',nombre:'Resultado ejercicio'};const r=calcularRegularizacion([c,cuenta('Capital','999.00')]);expect(r.resultadoCompleto).toBe(false);expect(r.sinClasificar).toHaveLength(1);expect(r.nominales).toHaveLength(0);});
 it('precision grande e inactiva con saldo',()=>{const r=calcularRegularizacion([{...cuenta('Ingreso','0.00','99999999999999.99'),activa:0},cuenta('Gasto','99999999999999.98','0.00',2)]);expect(r.resultadoPreliminar).toBe('0.01');expect(r.inactivasConSaldo).toEqual([1]);});
});
describe('C3C6 servicio y HTTP',()=>{
 it('una sola transaccion compartida con C3C5 y sin propuesta completa',async()=>{
  const d=await simularRegularizacion(7,9,1);expect(d.estado).toBe('INCOMPLETA');expect(d.propuestaCompleta).toBeNull();expect(d.cuentaResultado).toBeNull();expect(d.bloqueantes).toContain('CUENTA_RESULTADO_NO_CONFIGURADA');expect(m.diagnostico).toHaveBeenCalledWith(m,7,9,1);expect(m.commit).toHaveBeenCalledOnce();
  expect(m.query.mock.calls.map(([sql])=>sql).filter(sql=>sql==='START TRANSACTION READ ONLY')).toHaveLength(1);expect(m.query.mock.calls.some(([sql])=>/INSERT|UPDATE |DELETE|FOR UPDATE|ALTER|CREATE /i.test(sql))).toBe(false);
  const mov=m.query.mock.calls.find(([sql])=>sql.includes('FROM cont_asientos'));expect(mov?.[1]).toEqual(['2030-01-01','2030-01-01','2030-01-01','2030-01-01',7,9,'2030-12-31']);
  const html=renderToStaticMarkup(createElement(ResultadoRegularizacion,{d}));expect(html).toContain('SIMULACIÓN INCOMPLETA');expect(html).toContain('No es un asiento formal');expect(html).toContain('no disponible');expect(html).not.toContain('Aprobar');expect(html).not.toContain('Contabilizar');
 });
 it('descuadre bloquea confiabilidad y nunca se fabrica contrapartida',async()=>{const d=await m.diagnostico();m.diagnostico.mockResolvedValue({...d,bloqueantes:['ASIENTOS_DESCUADRADOS']});const r=await simularRegularizacion(7,9,1);expect(r.resultadoConfiable).toBe(false);expect(r.propuestaCompleta).toBeNull();});
 it('no oculta movimientos cuya cuenta no pertenece al catalogo autorizado',async()=>{
  m.query.mockImplementation(async(sql:string)=>sql.includes('FROM cont_asientos')?[[{cuenta_id:999,debe:'1.00',haber:'0.00',debeAnterior:'0.00',haberAnterior:'0.00'}]]:[[]]);
  const d=await simularRegularizacion(7,9,1);expect(d.calculo.sinClasificar[0]).toMatchObject({cuentaId:999,codigo:'(sin cuenta)',tipo:'SIN_CLASIFICAR'});expect(d.bloqueantes).toContain('CLASIFICACION_INSUFICIENTE');expect(d.resultadoConfiable).toBe(false);
 });
 it('errores cancelan la transaccion sin devolver datos parciales',async()=>{m.diagnostico.mockRejectedValue(Error('fallo'));await expect(simularRegularizacion(7,9,1)).rejects.toThrow('fallo');expect(m.rollback).toHaveBeenCalledOnce();expect(m.release).toHaveBeenCalledOnce();expect(m.commit).not.toHaveBeenCalled();});
 it.each([0,-1,1.5,2147483648])('identificador invalido %s no consulta',async id=>{await expect(simularRegularizacion(7,9,id)).rejects.toMatchObject({status:400});expect(m.getConnection).not.toHaveBeenCalled();});
 it('HTTP exige permiso de calendario',async()=>{m.guard.mockResolvedValue({error:new Response(null,{status:403})});expect((await regularizacionGet(new Request('http://local?entidad=9'),'lab','1')).status).toBe(403);expect(m.guard).toHaveBeenCalledWith('lab','ver');expect(m.getConnection).not.toHaveBeenCalled();});
 it.each(['0','-1','abc','2147483648'])('HTTP valida ejercicio %s',async id=>{expect((await regularizacionGet(new Request('http://local?entidad=9'),'lab',id)).status).toBe(400);expect(m.getConnection).not.toHaveBeenCalled();});
 it.each(['','?entidad=0','?entidad=9&entidad=10'])('HTTP valida entidad %s',async qs=>{expect((await regularizacionGet(new Request('http://local/'+qs),'lab','1')).status).toBe(400);});
 it('HTTP usa empresa de sesion y cache privado',async()=>{const r=await regularizacionGet(new Request('http://local?entidad=9&empresa_id=8'),'lab','1');expect(r.status).toBe(200);expect((await r.json()).empresaId).toBe(7);expect(r.headers.get('Cache-Control')).toBe('private, no-store');});
});
