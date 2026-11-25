import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASE, DIR_SALIDA, calificar, desCalificar, generar, sentenciasMigracion } from '../../../scripts/ci/canecas/generar-instalacion-phpmyadmin.mjs';

const archivos = generar() as Record<string, string>;
const nombres = Object.keys(archivos);
const ejecutable = (sql: string) => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const compactar = (s: string) => s.replace(/\s+/g, ' ').trim();
const ESCRITURA = /^(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|TRUNCATE|REPLACE|GRANT|REVOKE|RENAME|SET)\b/i;
const etapas = nombres.filter(n => /^\d+-etapa\d/.test(n)), verificaciones = nombres.filter(n => /^\d+-verificar/.test(n));
const TRIGGER = '12-etapa6-reemplazar-trigger.sql';
/** Separa sentencias como lo haría el cliente: por `;` (o por `//` en la etapa del trigger, cuyo cuerpo contiene `;`). */
const partir = (archivo: string) => (archivo === TRIGGER ? ejecutable(archivos[archivo]).split(/\/\/\s*\n?/) : ejecutable(archivos[archivo]).split(/;\s*\n/)).map(x => x.trim()).filter(Boolean);

describe('instalación manual por etapas (phpMyAdmin): archivos SQL generados', () => {
  it('los archivos versionados son exactamente los que genera el script desde las fuentes auditadas (sin deriva)', () => {
    expect(readdirSync(DIR_SALIDA).sort()).toEqual([...nombres].sort());
    for (const n of nombres) expect(readFileSync(`${DIR_SALIDA}/${n}`, 'utf8'), n).toBe(archivos[n]);
  });
  it('son 14 archivos: 6 etapas de escritura intercaladas con 8 verificaciones de solo lectura', () => {
    expect(nombres).toHaveLength(14);
    expect(etapas).toHaveLength(6);
    expect(verificaciones).toHaveLength(8);
    expect(nombres.map(n => n.slice(0, 2))).toEqual(Array.from({ length: 14 }, (_, i) => String(i + 1).padStart(2, '0')));
  });
  it('fidelidad: las sentencias de cada etapa son EXACTAMENTE las de sql/migrate-2026-11-canecas-simplificacion-wip.sql (salvo el esquema explícito)', () => {
    const m = sentenciasMigracion();
    const sentencia = (archivo: string) => partir(archivo).filter(x => !/^SELECT CASE WHEN/.test(x)).map(x => x.replace(/;$/, '').trim());
    const esperado: Record<string, string> = { '02-etapa1-crear-secuencias.sql': m.secuencias, '04-etapa2-sembrar-contadores.sql': m.siembra, '06-etapa3-alterar-ventas.sql': m.ventas, '08-etapa4-alterar-productos.sql': m.productos, '10-etapa5-alterar-compras.sql': m.compras, '12-etapa6-reemplazar-trigger.sql': m.trigger };
    for (const [archivo, original] of Object.entries(esperado)) {
      const propias = sentencia(archivo);
      expect(propias, archivo).toHaveLength(1); // una sola sentencia de escritura por etapa
      expect(compactar(desCalificar(propias[0])), archivo).toBe(compactar(original));
    }
  });
  it('conserva íntegros el CHECK, los índices únicos, las columnas virtuales y el trigger de la migración', () => {
    const todo = etapas.map(n => archivos[n]).join('\n');
    for (const fragmento of ['CONSTRAINT chk_can_venta_direccion CHECK (direccion_entrega IS NULL OR CHAR_LENGTH(TRIM(direccion_entrega)) > 0)', 'ADD UNIQUE KEY uq_can_venta_doc_auto (empresa_id,doc_auto)', 'ADD UNIQUE KEY uq_can_producto_activo_unico (empresa_id,activo_unico)', 'ADD UNIQUE KEY uq_can_compra_ref_auto (empresa_id,ref_auto)', "GENERATED ALWAYS AS (IF(documento REGEXP '^VTA-[0-9]{6,15}$', documento, NULL)) VIRTUAL", "GENERATED ALWAYS AS (IF(referencia REGEXP '^COMP-[0-9]{6,15}$', referencia, NULL)) VIRTUAL", 'GENERATED ALWAYS AS (IF(activo = 1, 1, NULL)) VIRTUAL', 'OR NOT (NEW.direccion_entrega <=> OLD.direccion_entrega)', "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_INMUTABLE'", 'CREATE OR REPLACE TRIGGER', "COALESCE(h.maximo, 0)", "REGEXP '^COMP[ _-]?[0-9]{1,15}$'"]) expect(todo, fragmento).toContain(fragmento);
  });
  it('cada referencia a tabla o trigger lleva el esquema explícito: sin USE, sin DATABASE() y sin tablas sin calificar', () => {
    for (const n of nombres) {
      const sql = ejecutable(archivos[n]);
      expect(sql, n).not.toMatch(/\bUSE\s/i);
      expect(sql, n).not.toMatch(/DATABASE\(\)/i);
      expect(sql, n).not.toMatch(/\b(FROM|JOIN|INTO|TABLE|REFERENCES|ON)\s+(canecas_\w+|empresas)\b/); // toda tabla va como `esquema`.tabla
      expect(sql, n).not.toMatch(/TRIGGER\s+trg_/);
      for (const m of sql.matchAll(/TABLE_SCHEMA\s*=\s*'([^']+)'|TRIGGER_SCHEMA\s*=\s*'([^']+)'|CONSTRAINT_SCHEMA\s*=\s*'([^']+)'/g)) expect(m[1] ?? m[2] ?? m[3]).toBe(BASE);
      for (const m of sql.matchAll(/`([^`]+)`\.\w+/g)) expect(m[1]).toBe(BASE);
    }
  });
  it('seguridad: sin DROP, TRUNCATE, DELETE, ni desactivar claves foráneas o comprobaciones; solo ASCII', () => {
    for (const n of nombres) {
      const sql = ejecutable(archivos[n]);
      expect(sql, n).not.toMatch(/\b(DROP|TRUNCATE|RENAME)\b|DELETE\s+FROM|foreign_key_checks|check_constraint_checks|sql_mode|GRANT|REVOKE|FLUSH/i);
      expect(archivos[n], n).toMatch(/^[\x00-\x7f]*$/);
    }
  });
  it('las verificaciones son solo lectura: únicamente SELECT', () => {
    for (const n of verificaciones) {
      const sentencias = ejecutable(archivos[n]).split(/;\s*\n/).map(x => x.trim()).filter(Boolean);
      expect(sentencias.length, n).toBeGreaterThan(0);
      for (const s of sentencias) { expect(s, n).toMatch(/^SELECT\b/); expect(s, n).not.toMatch(ESCRITURA); }
    }
  });
  it('cada etapa de escritura empieza con una guarda que falla (error 1242) si la etapa previa no está completa', () => {
    for (const n of etapas) {
      const sentencias = partir(n);
      expect(sentencias[0], n).toMatch(/^SELECT CASE WHEN [\s\S]* THEN 'GUARDA OK etapa \d' ELSE \(SELECT 'DETENER: prerequisitos de la etapa \d incompletos' UNION ALL SELECT '.*'\) END AS guarda$/);
      expect(sentencias, n).toHaveLength(2);
      expect(sentencias[1], n).toMatch(ESCRITURA);
    }
  });
  it('solo la etapa 6 (trigger) usa el delimitador // y lo declara en su encabezado', () => {
    expect(archivos['12-etapa6-reemplazar-trigger.sql']).toMatch(/campo "Delimitador" en \/\//);
    for (const n of nombres.filter(x => x !== '12-etapa6-reemplazar-trigger.sql')) expect(ejecutable(archivos[n]), n).not.toMatch(/\/\/\s*$/m);
    expect(ejecutable(archivos[TRIGGER]).trimEnd().endsWith('END//')).toBe(true); // la sentencia del trigger termina en // (su cuerpo contiene ;)
    expect(partir(TRIGGER)).toHaveLength(2); // guarda + CREATE OR REPLACE TRIGGER
  });
  it('el preflight y el postcheck de origen se conservan completos (22 y 15) y las verificaciones por tabla incluyen sus 5 secciones del contrato', () => {
    expect((ejecutable(archivos['01-verificar-previo.sql']).match(/^SELECT /gm) ?? [])).toHaveLength(22);
    expect((ejecutable(archivos['14-verificar-final.sql']).match(/'(?!contrato)[^']+' AS verificacion/g) ?? []).length).toBeGreaterThanOrEqual(15);
    for (const t of ['canecas_secuencias', 'canecas_ventas', 'canecas_productos', 'canecas_compras']) for (const s of ['tablas', 'columnas', 'indices', 'foraneas', 'checks']) expect(archivos['14-verificar-final.sql']).toContain(`'contrato ${s} de ${t} (huella exacta)'`);
    expect(archivos['14-verificar-final.sql']).toContain("'trigger trg_can_venta_bu exacto");
    expect(archivos['14-verificar-final.sql']).toContain("'trigger trg_can_venta_bd exacto");
  });
  it('calificar/desCalificar son inversos y no tocan literales de texto', () => {
    const original = "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_NAME='canecas_secuencias'";
    expect(calificar(original)).toBe(original.replace(/^/, ''));
    const consulta = 'SELECT 1 FROM canecas_ventas v JOIN empresas e ON 1=1';
    expect(desCalificar(calificar(consulta))).toBe(consulta);
    expect(calificar(consulta)).toContain('`u611730801_Plataforma`.canecas_ventas');
  });
});
