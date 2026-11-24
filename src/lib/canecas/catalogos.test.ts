import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { esquemaCatalogo, normalizarNitCatalogo, normalizarNombreCatalogo, sqlListarCatalogo } from './catalogos';

describe('normalización y validación de catálogos de Canecas', () => {
  it('normaliza nombres sin acentos, mayúsculas ni espacios repetidos', () => {
    expect(normalizarNombreCatalogo('  Aceites   del Sür ')).toBe('ACEITES DEL SUR');
    expect(normalizarNombreCatalogo('López')).toBe(normalizarNombreCatalogo('LOPEZ'));
  });
  it('normaliza el NIT sin separadores y vacío a null', () => {
    expect(normalizarNitCatalogo(' 1234-567.8 ')).toBe('12345678');
    expect(normalizarNitCatalogo('  ')).toBeNull();
    expect(normalizarNitCatalogo(null)).toBeNull();
  });
  it('acepta solo el nombre y convierte opcionales vacíos en null', () => {
    expect(esquemaCatalogo.parse({ nombre_comercial: ' Distribuidora ', nit: '', telefono: '', direccion: '' })).toEqual({ nombre_comercial: 'Distribuidora', nit: null, telefono: null, direccion: null });
    expect(esquemaCatalogo.parse({ nombre_comercial: 'X', nit: '123-4', telefono: '+502 5555-1111', direccion: 'Zona 1' })).toMatchObject({ nit: '123-4', telefono: '+502 5555-1111' });
  });
  it.each([
    [{ nombre_comercial: '' }], [{ nombre_comercial: '   ' }], [{ nombre_comercial: 'x'.repeat(201) }], [{}],
    [{ nombre_comercial: 'A', nit: '12;DROP' }], [{ nombre_comercial: 'A', telefono: 'abc' }], [{ nombre_comercial: 'A', direccion: 'x'.repeat(301) }],
    [{ nombre_comercial: 'A', empresa_id: 99 }], [{ nombre_comercial: 'A', creado_por: 1 }], [{ nombre_comercial: 'A', moneda: 'USD' }],
  ])('rechaza datos inválidos o no permitidos: %j', entrada => { expect(esquemaCatalogo.safeParse(entrada).success).toBe(false); });
  it('el listado filtra por empresa con un único parámetro', () => {
    for (const c of ['proveedores', 'clientes'] as const) {
      const sql = sqlListarCatalogo(c);
      expect(sql).toMatch(/WHERE empresa_id=\?/);
      expect(sql.match(/\?/g)).toHaveLength(1);
    }
  });
});

describe('independencia respecto de Operaciones y Compras', () => {
  const lee = (archivo: string) => readFileSync(archivo, 'utf8');
  const codigo = ['src/lib/canecas/catalogos.ts', 'src/app/api/empresas/[slug]/canecas/[recurso]/route.ts', 'src/components/canecas/canecas-client.tsx', 'src/lib/canecas/comercial-api.ts', 'src/lib/canecas/ventas.ts', 'src/lib/canecas/reportes.ts', 'src/components/canecas/reportes-comerciales.tsx', 'src/components/canecas/mapeo-proveedores.tsx'];
  it.each(codigo)('%s no consulta ni escribe compras_proveedores ni importa Compras/TMS', archivo => {
    const texto = lee(archivo).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // sin comentarios
    expect(texto).not.toMatch(/compras_proveedores/);
    expect(texto).not.toMatch(/from ["']@\/lib\/(compras|tms|clientes|facturacion)/);
    expect(texto).not.toMatch(/FROM\s+clientes\b|JOIN\s+clientes\b|tms_clientes/i);
  });
  it('la migración de catálogos solo se relaciona con empresas, usuarios y canecas_*', () => {
    const sql = lee('sql/migrate-2026-11-canecas-catalogos-wip.sql').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    const referencias = [...sql.matchAll(/REFERENCES\s+(\w+)/g)].map(m => m[1]);
    expect(new Set(referencias)).toEqual(new Set(['empresas', 'usuarios', 'canecas_proveedores']));
    expect(sql).not.toMatch(/compras_proveedores/);
  });
  it('la migración es aditiva: sin DML, sin borrados de objetos ni triggers', () => {
    const sql = lee('sql/migrate-2026-11-canecas-catalogos-wip.sql').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE\s+\w+\s+SET|TRUNCATE|DROP)\b/i);
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/TRIGGER/i);
  });
  it('el único acceso a Compras es la lectura histórica: solo SELECT, sin importar sus módulos', () => {
    const texto = lee('src/lib/canecas/historico-proveedores.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(texto).toMatch(/LEFT JOIN compras_proveedores/);
    expect(texto).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+compras_proveedores/i);
    expect(texto).not.toMatch(/from ["']@\/lib\/(compras|tms|clientes|facturacion)/);
    // Ningún otro archivo de Canecas (código de producción) consulta compras_proveedores.
    for (const archivo of ['src/lib/canecas/redistribucion.ts', 'src/lib/canecas/salidas-fifo.ts', 'src/lib/canecas/confirmar.ts']) expect(lee(archivo)).not.toMatch(/compras_proveedores/);
  });
});
