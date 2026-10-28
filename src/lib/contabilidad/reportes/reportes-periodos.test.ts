import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import type {PoolConnection} from 'mysql2/promise';
import ExcelJS from 'exceljs';
const m=vi.hoisted(()=>({query:vi.fn(),globalQuery:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),guard:vi.fn()}));
vi.mock('@/lib/db',()=>({getPool:()=>({getConnection:async()=>m}),query:m.globalQuery}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_PROHIBIDO');}}));
vi.mock('@/lib/tenant',()=>({requireTenantContReporte:m.guard}));
import {filtroPeriodo,resolverPeriodoReporte} from './periodo';
import {libroDiario,libroMayor,balanceComprobacion} from './reportes';
import {reporteHttp,opcionesHttp} from './http';
import {exportarXlsx} from './exportar';
import {SelectorPeriodoReporte,ResumenPeriodoReporte} from '@/components/contabilidad/reporte-periodo';
import {ReportesContablesClient} from '@/components/contabilidad/reportes-client';
const periodo={id:3,ejercicio_id:1,ejercicio:'LAB2026',codigo:'ENE2026',desde:'2026-01-01',hasta:'2026-01-31',estado:'CERRADO',version:2,revision_cierre:1};
beforeEach(()=>{
 vi.resetAllMocks();m.guard.mockResolvedValue({empresa:{id:7},session:{id:41,rol:'Contabilidad'}});
 m.query.mockImplementation(async(sql:string)=>{
  if(sql.includes('p.ejercicio_id'))return [[periodo]];
  if(sql.includes('FROM cont_entidades'))return [[{id:9,codigo:'LAB',nombre:'Libro ficticio'}]];
  if(sql.includes('FROM cont_periodos'))return [[{id:3,estado:'CERRADO',version:2,revision_cierre:1}]];
  if(sql.includes('COUNT(*) AS n'))return [[{n:0}]];
  if(sql.includes('AS descuadrados'))return [[{debe:'0.00',haber:'0.00',descuadrados:0}]];
  if(sql.includes('FROM cont_cuentas'))return [[{id:1,codigo:'1',nombre:'Cuenta ficticia',tipo:'Activo',nivel:1}]];
  if(sql.startsWith('SET ')||sql.startsWith('START ')||sql.includes('FROM cont_asientos')||sql.includes('FROM cont_asiento_detalle'))return [[]];
  throw Error('SQL de prueba no previsto');
 });
 m.globalQuery.mockImplementation(async(sql:string)=>sql.includes('FROM cont_entidades')?[{id:9}]:[]);
});
describe('Reportes por período: contrato, tenant y lectura consistente',()=>{
 it.each(['periodo=0','periodo=-1','periodo=abc','periodo=2147483648','periodo=1&periodo=2','periodo=1&desde=','periodo=1&hasta=2026-01-31'])('rechaza filtro ambiguo %s',qs=>{expect(()=>filtroPeriodo(new URLSearchParams(qs))).toThrow();});
 it('conserva fechas manuales y solo acepta un identificador positivo',()=>{expect(filtroPeriodo(new URLSearchParams())).toEqual({});expect(filtroPeriodo(new URLSearchParams('periodo=3'))).toEqual({periodoId:3});});
 it.each(['diario','mayor','balance'] as const)('%s resuelve el rango y versión en la misma transacción READ ONLY sin locks de escritura',async tipo=>{
  const d=tipo==='diario'?await libroDiario(7,9,{periodoId:3}):tipo==='mayor'?await libroMayor(7,9,1,{periodoId:3}):await balanceComprobacion(7,9,{periodoId:3});
  expect(d).toMatchObject({desde:periodo.desde,hasta:periodo.hasta,periodoSeleccionado:{id:3,estado:'CERRADO',version:2,revisionCierre:1}});
  expect(m.query.mock.calls[0][0]).toContain('SET TRANSACTION');expect(m.query.mock.calls[1][0]).toBe('START TRANSACTION READ ONLY');
  expect(m.query.mock.calls[2][1]).toEqual([7,9,3]);
  const scoped=m.query.mock.calls.filter(([sql])=>String(sql).includes('a.estado'));
  expect(scoped.length).toBeGreaterThan(0);for(const [,params] of scoped)expect(params).toEqual(expect.arrayContaining([7,9,'2026-01-01','2026-01-31']));
  expect(m.query.mock.calls.some(([sql])=>/FOR UPDATE|INSERT|DELETE|UPDATE cont_/.test(sql))).toBe(false);expect(m.commit).toHaveBeenCalledOnce();
 });
 it('período ajeno/inexistente revierte sin consultar movimientos',async()=>{
  m.query.mockImplementation(async(sql:string)=>{if(sql.includes('p.ejercicio_id'))return [[]];return [[]];});
  await expect(libroDiario(7,9,{periodoId:99})).rejects.toMatchObject({status:404});
  expect(m.rollback).toHaveBeenCalledOnce();expect(m.query.mock.calls.some(([sql])=>sql.includes('FROM cont_asientos'))).toBe(false);
 });
 it('valida también llamadas directas al servicio',async()=>{await expect(resolverPeriodoReporte(m as unknown as PoolConnection,7,9,{periodoId:3,desde:'2026-01-01'})).rejects.toMatchObject({status:400});expect(m.query).not.toHaveBeenCalled();});
 it('fallo al consultar revierte y no se convierte en reporte vacío',async()=>{
  m.query.mockRejectedValueOnce(Error('Fallo ficticio'));await expect(libroDiario(7,9,{periodoId:3})).rejects.toThrow();expect(m.rollback).toHaveBeenCalledOnce();expect(m.commit).not.toHaveBeenCalled();
 });
 it.each(['diario','mayor','balance'] as const)('HTTP %s conserva su permiso propio y no permite seleccionar otro tenant',async tipo=>{
  m.guard.mockResolvedValue({error:new Response(null,{status:403})});expect((await reporteHttp(new Request('http://local?entidad=9&periodo=3&cuentaId=1'),'lab',tipo)).status).toBe(403);expect(m.query).not.toHaveBeenCalled();
 });
 it('HTTP aplica período, cache privada y rechaza mezclar fechas',async()=>{
  const r=await reporteHttp(new Request('http://local?entidad=9&periodo=3&empresaId=8'),'lab','diario');expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(m.query.mock.calls[2][1]).toEqual([7,9,3]);expect((await r.json()).periodoSeleccionado.codigo).toBe('ENE2026');
  expect((await reporteHttp(new Request('http://local?entidad=9&periodo=3&desde=2026-01-01'),'lab','diario')).status).toBe(400);
 });
 it('opciones de períodos se acotan a la entidad autorizada sin exigir permisos de escritura',async()=>{
  expect((await opcionesHttp(new Request('http://local?entidad=9'),'lab')).status).toBe(200);
  expect(m.globalQuery.mock.calls.find(([sql])=>sql.includes('FROM cont_periodos'))?.[1]).toEqual([7,9]);
  expect((await opcionesHttp(new Request('http://local?entidad=8'),'lab')).status).toBe(404);
  expect((await opcionesHttp(new Request('http://local?entidad=9&entidad=8'),'lab')).status).toBe(400);
 });
 it('esquema sin calendario mantiene las opciones de fechas manuales',async()=>{
  m.globalQuery.mockImplementation(async(sql:string)=>{if(sql.includes('FROM cont_entidades'))return [{id:9}];if(sql.includes('FROM cont_periodos'))throw {code:'ER_NO_SUCH_TABLE'};return [];});
  expect(await (await opcionesHttp(new Request('http://local?entidad=9'),'lab')).json()).toMatchObject({periodos:[],calendarioDisponible:false});
 });
 it('Excel incluye período, rango y revisión sin presentarse como evidencia de cierre',async()=>{
  const data=await libroDiario(7,9,{periodoId:3});const wb=new ExcelJS.Workbook();await wb.xlsx.load(new Uint8Array(await exportarXlsx('diario',data)).buffer);
  const content=JSON.stringify(wb.worksheets[0].getSheetValues());expect(content).toContain('ENE2026');expect(content).toContain('Revisión de cierre');expect(content).toContain('no reproduce');
 });
 it('selector y resumen tienen etiquetas, contraste y advertencia de alcance (render estático, no DOM)',()=>{
  const select=renderToStaticMarkup(createElement(SelectorPeriodoReporte,{periodos:[],value:'',disabled:true,onChange:()=>{}}));expect(select).toContain('Período contable');expect(select).toContain('Fechas manuales');expect(select).toContain('bg-[var(--input)]');expect(select).toContain('disabled');
  const r=awaitableSummary();expect(r).toContain('revisión de cierre 1');expect(r).toContain('ni reproduce');
  const pagina=renderToStaticMarkup(createElement(ReportesContablesClient,{slug:'lab-a',puedeDiario:true,puedeMayor:false,puedeBalance:false}));
  expect(pagina).toContain('Período contable');expect(pagina).toContain('Diario');expect(pagina).not.toContain('>Mayor</button>');expect(pagina).not.toContain('>Balance de comprobación</button>');
 });
});
function awaitableSummary(){return renderToStaticMarkup(createElement(ResumenPeriodoReporte,{periodo:{id:3,ejercicioId:1,ejercicio:'LAB2026',codigo:'ENE2026',desde:periodo.desde,hasta:periodo.hasta,estado:'CERRADO',version:2,revisionCierre:1}}));}
