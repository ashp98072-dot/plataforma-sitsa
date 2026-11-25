import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ejecutarSimplificacionControlado } from '../../../scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs';
import { triggersEsperadosSimplificacion } from '../../../scripts/ci/canecas/contrato-simplificacion.mjs';

const conexion = (version: string, grants: string[]) => ({
  query: async (sql: string) => {
    if (sql.startsWith('SELECT DATABASE() base')) return [[{ base: 'u611730801_Plataforma', version }], []];
    if (sql === 'SHOW GRANTS FOR CURRENT_USER') return [grants.map(g => ({ g })), []];
    throw new Error(`consulta inesperada antes de validar: ${sql.slice(0, 40)}`);
  },
});
const concesion = (permisos: string) => `GRANT ${permisos} ON \`u611730801\\_Plataforma\`.* TO \`u\`@\`%\``;
const leer = (f: string) => readFileSync(`sql/${f}`, 'utf8');

describe('instalador de simplificación: condiciones previas (sin base de datos)', () => {
  it('se detiene ante una versión distinta de 11.8.9', async () => {
    await expect(ejecutarSimplificacionControlado(conexion('10.11.14-MariaDB', [concesion('ALL PRIVILEGES')]))).rejects.toThrow('versión incompatible');
  });
  it.each(['CREATE, ALTER, INDEX, REFERENCES, TRIGGER', 'SELECT, ALTER, INDEX, REFERENCES, TRIGGER', 'SELECT, CREATE, INDEX, REFERENCES, TRIGGER', 'SELECT, CREATE, ALTER, REFERENCES, TRIGGER', 'SELECT, CREATE, ALTER, INDEX, TRIGGER', 'SELECT, CREATE, ALTER, INDEX, REFERENCES'])('exige SELECT, CREATE, ALTER, INDEX, REFERENCES y TRIGGER: %s', async permisos => {
    await expect(ejecutarSimplificacionControlado(conexion('11.8.9-MariaDB-ubu2404', [concesion(permisos)]))).rejects.toThrow('privilegios directos insuficientes');
  });
  it('acepta el nombre de la base escapado tal como lo devuelve MariaDB (supera los privilegios)', async () => {
    await expect(ejecutarSimplificacionControlado(conexion('11.8.9-MariaDB-ubu2404', [concesion('ALL PRIVILEGES')]))).rejects.toThrow('consulta inesperada antes de validar');
  });
});

describe('migración de simplificación: contenido y garantías', () => {
  const migracion = leer('migrate-2026-11-canecas-simplificacion-wip.sql');
  const sinComentarios = migracion.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  it('es aditiva: sin DROP, TRUNCATE, DELETE ni UPDATE de datos', () => {
    expect(sinComentarios).not.toMatch(/\b(DROP|TRUNCATE|RENAME)\b|DELETE\s+FROM/i);
    expect(sinComentarios).not.toMatch(/^\s*UPDATE\b/im);
    expect(sinComentarios).not.toMatch(/FOREIGN_KEY_CHECKS|foreign_key_checks/);
  });
  it('siembra los contadores con el máximo histórico por empresa: sin ceros a ciegas, sin UPDATE, sin renumerar y sin rellenar huecos', () => {
    const insert = sinComentarios.match(/INSERT INTO canecas_secuencias[\s\S]*?;/)![0];
    expect(insert).toContain('MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(referencia))');
    expect(insert).toContain('MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(documento))');
    expect(insert).toContain('MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(codigo))');
    expect(insert).toContain('GROUP BY empresa_id'); // por empresa
    expect(insert).toContain('FROM empresas e'); // una fila por empresa y tipo, incluidas las que no tienen historial
    expect(insert).toContain('COALESCE(h.maximo, 0)');
    expect(insert).not.toMatch(/INSERT IGNORE|ON DUPLICATE|REPLACE INTO/i); // INSERT IGNORE no es conciliación
    expect(insert.match(/\{1,15\}/g)).toHaveLength(3);
  });
  it('el preflight detiene los sufijos de más de 15 dígitos y reporta máximos y formatos mixtos por tabla', () => {
    const pre = leer('preflight-2026-11-canecas-simplificacion-wip.sql');
    for (const t of ['COMP', 'VTA', 'CAN']) {
      expect(pre).toContain(`'sin sufijos ${t} de más de 15 dígitos`);
      expect(pre).toContain(`'máximo histórico ${t} por empresa (empresa:valor)'`);
    }
    expect(pre).toContain("'documentos históricos con formato distinto de PREFIJO-######'");
    expect(pre.match(/\{16,\}/g)).toHaveLength(3);
  });
  it('el postcheck exige contadores no menores que el máximo histórico y la instalación verifica que no haya números en uso', () => {
    const post = leer('postcheck-2026-11-canecas-simplificacion-wip.sql');
    expect(post).toContain("'contadores no menores que el máximo histórico'");
    expect(post).toContain("'siguientes números ya en uso por un documento'");
    expect(post).toContain("'empresas sin contador completo'");
    const instalador = readFileSync('scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs', 'utf8');
    expect(instalador).toContain("recuento(post, 'siguientes números ya en uso por un documento') !== 0");
  });
  it('reemplaza el trigger de forma atómica (nunca queda sin trigger) y protege direccion_entrega', () => {
    expect(sinComentarios).toMatch(/CREATE OR REPLACE TRIGGER trg_can_venta_bu/);
    expect(triggersEsperadosSimplificacion().map(t => t.TRIGGER_NAME)).toEqual(['trg_can_venta_bu', 'trg_can_venta_bd']);
    expect(triggersEsperadosSimplificacion()[0].ACTION_STATEMENT).toContain('NEW.direccion_entrega <=> OLD.direccion_entrega');
  });
  it('garantiza una caneca activa por empresa con una columna virtual y un índice único', () => {
    expect(sinComentarios).toMatch(/activo_unico TINYINT\(1\) GENERATED ALWAYS AS \(IF\(activo = 1, 1, NULL\)\) VIRTUAL/);
    expect(sinComentarios).toMatch(/UNIQUE KEY uq_can_producto_activo_unico \(empresa_id,activo_unico\)/);
  });
  it('la base garantiza la unicidad del formato generado (COMP-######/VTA-######) por empresa, también frente a documentos manuales y concurrentes', () => {
    expect(sinComentarios).toMatch(/ADD COLUMN ref_auto VARCHAR\(250\) GENERATED ALWAYS AS \(IF\(referencia REGEXP '\^COMP-\[0-9\]\{6,15\}\$', referencia, NULL\)\) VIRTUAL/);
    expect(sinComentarios).toMatch(/ADD COLUMN doc_auto VARCHAR\(250\) GENERATED ALWAYS AS \(IF\(documento REGEXP '\^VTA-\[0-9\]\{6,15\}\$', documento, NULL\)\) VIRTUAL/);
    expect(sinComentarios).toMatch(/UNIQUE KEY uq_can_compra_ref_auto \(empresa_id,ref_auto\)/);
    expect(sinComentarios).toMatch(/UNIQUE KEY uq_can_venta_doc_auto \(empresa_id,doc_auto\)/);
    const pre = leer('preflight-2026-11-canecas-simplificacion-wip.sql');
    expect(pre).toContain("'sin referencias COMP-###### duplicadas dentro de una empresa'");
    expect(pre).toContain("'sin documentos VTA-###### duplicados dentro de una empresa'");
  });
  it('tiene exactamente 5 sentencias (CREATE TABLE, siembra de contadores, 3 ALTER) y 1 trigger, como espera el instalador', () => {
    const [ddl, triggers] = migracion.split('DELIMITER //');
    expect(ddl.split('\n').filter(l => !/^\s*--/.test(l)).join('\n').split(';').map(x => x.trim()).filter(Boolean)).toHaveLength(5);
    expect(triggers.split('//').filter(x => /CREATE OR REPLACE TRIGGER/.test(x))).toHaveLength(1);
  });
  it('preflight, postcheck y recuperación existen, son de solo lectura y no desactivan comprobaciones', () => {
    for (const f of ['preflight-2026-11-canecas-simplificacion-wip.sql', 'postcheck-2026-11-canecas-simplificacion-wip.sql', 'recuperacion-canecas-simplificacion-solo-lectura.sql']) {
      const texto = leer(f).split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
      expect(texto).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|SET)\b/i);
      expect(texto).not.toMatch(/foreign_key_checks/i);
    }
    expect((leer('preflight-2026-11-canecas-simplificacion-wip.sql').match(/^SELECT /gm) ?? [])).toHaveLength(22);
    expect((leer('postcheck-2026-11-canecas-simplificacion-wip.sql').match(/^SELECT /gm) ?? [])).toHaveLength(15);
  });
});
