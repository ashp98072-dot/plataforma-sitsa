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
  it('reemplaza el trigger de forma atómica (nunca queda sin trigger) y protege direccion_entrega', () => {
    expect(sinComentarios).toMatch(/CREATE OR REPLACE TRIGGER trg_can_venta_bu/);
    expect(triggersEsperadosSimplificacion().map(t => t.TRIGGER_NAME)).toEqual(['trg_can_venta_bu', 'trg_can_venta_bd']);
    expect(triggersEsperadosSimplificacion()[0].ACTION_STATEMENT).toContain('NEW.direccion_entrega <=> OLD.direccion_entrega');
  });
  it('garantiza una caneca activa por empresa con una columna virtual y un índice único', () => {
    expect(sinComentarios).toMatch(/activo_unico TINYINT\(1\) GENERATED ALWAYS AS \(IF\(activo = 1, 1, NULL\)\) VIRTUAL/);
    expect(sinComentarios).toMatch(/UNIQUE KEY uq_can_producto_activo_unico \(empresa_id,activo_unico\)/);
  });
  it('tiene exactamente 3 sentencias DDL y 1 trigger, como espera el instalador', () => {
    const [ddl, triggers] = migracion.split('DELIMITER //');
    expect(ddl.split('\n').filter(l => !/^\s*--/.test(l)).join('\n').split(';').map(x => x.trim()).filter(Boolean)).toHaveLength(3);
    expect(triggers.split('//').filter(x => /CREATE OR REPLACE TRIGGER/.test(x))).toHaveLength(1);
  });
  it('preflight, postcheck y recuperación existen, son de solo lectura y no desactivan comprobaciones', () => {
    for (const f of ['preflight-2026-11-canecas-simplificacion-wip.sql', 'postcheck-2026-11-canecas-simplificacion-wip.sql', 'recuperacion-canecas-simplificacion-solo-lectura.sql']) {
      const texto = leer(f).split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
      expect(texto).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|SET)\b/i);
      expect(texto).not.toMatch(/foreign_key_checks/i);
    }
    expect((leer('preflight-2026-11-canecas-simplificacion-wip.sql').match(/^SELECT /gm) ?? [])).toHaveLength(12);
    expect((leer('postcheck-2026-11-canecas-simplificacion-wip.sql').match(/^SELECT /gm) ?? [])).toHaveLength(10);
  });
});
