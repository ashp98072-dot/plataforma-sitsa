import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()}));
vi.mock('@/lib/db',()=>({getPool:()=>({getConnection:async()=>m})}));
import {libroDiario} from './reportes/reportes';
beforeEach(()=>{vi.resetAllMocks();m.query.mockImplementation(async(sql:string)=>{
  if(sql.includes('FROM cont_entidades'))return [[{id:9,codigo:'LAB',nombre:'Libro ficticio'}]];
  if(sql.includes('COUNT(*) AS n'))return [[{n:0}]];
  if(sql.includes('AS descuadrados'))return [[{debe:'0.00',haber:'0.00',descuadrados:0}]];
  if(sql.includes('FROM cont_periodos'))return [[{id:1,estado:'ABIERTO',version:3,revision_cierre:1}]];
  return [[]];
});});
describe('Reporte: revisión de períodos en la misma instantánea',()=>{
  it('lee revisiones antes del commit sin bloquear escritores',async()=>{
    const r=await libroDiario(7,9,{});
    expect(r.trazabilidadPeriodo).toMatchObject({empresaId:7,entidadId:9,revisiones:[{id:1,estado:'ABIERTO',version:3,revision_cierre:1}]});
    expect(m.query.mock.calls.some(([s])=>String(s).includes('FOR UPDATE'))).toBe(false);
    expect(m.query.mock.invocationCallOrder.at(-1)).toBeLessThan(m.commit.mock.invocationCallOrder[0]);
  });
  it('esquema antiguo no convierte datos vigentes en evidencia de cierre',async()=>{
    const fn=m.query.getMockImplementation()!;m.query.mockImplementation(async(sql:string)=>{if(sql.includes('FROM cont_periodos'))throw {code:'ER_BAD_FIELD_ERROR'};return fn(sql);});
    const r=await libroDiario(7,9,{});expect(r.trazabilidadPeriodo.esquema).toBe('SIN_ESQUEMA_C3C2');expect(r.trazabilidadPeriodo.revisiones).toEqual([]);
  });
});
