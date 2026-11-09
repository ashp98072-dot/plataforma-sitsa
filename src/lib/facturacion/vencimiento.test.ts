import { expect, it } from 'vitest';
import { calcularVencimiento, perfilCreditoSchema } from './vencimiento';
it.each([
  ['2026-07-15',30,'2026-08-14'], ['2026-07-15',0,'2026-07-15'],
  ['2024-02-28',1,'2024-02-29'], ['2026-11-06',2,'2026-11-08'],
  ['2026-12-31',1,'2027-01-01'],
])('fecha %s + %s calendario', (fecha,dias,esperado) => expect(calcularVencimiento(fecha,dias)).toBe(esperado));
it.each([-1,366,1.2,NaN,Infinity])('rechaza plazo %s', dias => expect(()=>calcularVencimiento('2026-07-15',dias)).toThrow());
it.each(['2026-02-29','2026-02-30','2026-13-01','0000-01-01','9999-12-31'])('rechaza fecha inválida o desbordamiento %s', fecha => expect(()=>calcularVencimiento(fecha,365)).toThrow());
it('no acepta autoridad o texto histórico como plazo estructurado',()=>{
  expect(perfilCreditoSchema.safeParse({dias:'30 días',aprobada:true,revision:0,motivo:'Configuración aprobada'}).success).toBe(false);
  expect(perfilCreditoSchema.safeParse({dias:30,aprobada:true,revision:0,motivo:'Configuración aprobada',empresaId:9}).success).toBe(false);
});
