import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Congela los esquemas (zod) de las rutas históricas: la simplificación (#688) agrega recursos nuevos y NO modifica estos.
// Las huellas son sha256 de las líneas tal como están en main (ca011db). Si una ruta histórica debe cambiar, hágase con una
// versión nueva y una decisión explícita, no en silencio.
const huella = (texto: string) => createHash('sha256').update(texto).digest('hex');
const lineas = (archivo: string, empiezaCon: string[]) => empiezaCon.map(p => {
  const l = readFileSync(archivo, 'utf8').split('\n').filter(x => x.startsWith(p));
  expect(l, p).toHaveLength(1);
  return l[0].replace(/\r$/, '');
});

describe('contratos históricos de la API de Canecas (no cambian)', () => {
  const ruta = 'src/app/api/empresas/[slug]/canecas/[recurso]/route.ts';
  it('route.ts: productos, compras, recepciones, salidas, valoración y demás esquemas históricos', () => {
    const l = lineas(ruta, ['  productos: z.object(', '  ubicaciones: z.object(', '  compras: z.object(', '  recepciones: z.object(', '  confirmar: z.object(', '  salidas: z.object(', '  reversar_salida: z.object(', '  valoracion_inicial: z.object(', '  gastos_posteriores: z.object(', '  precio_referencia: z.object(', '  mapeo_proveedor_compra: z.object(']);
    expect(huella(l.join('\n'))).toBe('2b2697817a4205e754e437310dd81fabca6729b306384a23e0be220d8cbf2192');
  });
  it('comercial-api.ts: ventas, anular_venta, redistribuciones y reversar_redistribucion', () => {
    const l = lineas('src/lib/canecas/comercial-api.ts', ['  ventas: z.object(', '  anular_venta: z.object(', '  redistribuciones: z.object(', '  reversar_redistribucion: z.object(']);
    expect(huella(l.join('\n'))).toBe('936e30576527e5383ed73c368dc43211576d94f41923359564058f1e8e684724');
  });
  it('los recursos nuevos conviven con los históricos sin reutilizar sus nombres', () => {
    const fuente = readFileSync(ruta, 'utf8');
    for (const nuevo of ['compras_ingreso', 'caneca_unica']) expect(fuente).toContain(`  ${nuevo}: z.object(`);
    expect(readFileSync('src/lib/canecas/comercial-api.ts', 'utf8')).toContain('  ventas_pos: z.object(');
  });
});
