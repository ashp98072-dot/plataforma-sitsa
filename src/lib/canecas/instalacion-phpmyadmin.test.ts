import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASE, DIR_SALIDA, EPILOGO_MODOS, MODOS_OK, PROLOGO_MODOS, calificar, desCalificar, generar, sentenciasMigracion } from '../../../scripts/ci/canecas/generar-instalacion-phpmyadmin.mjs';

const archivos = generar() as Record<string, string>;
const nombres = Object.keys(archivos);
const ejecutable = (sql: string) => sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const compactar = (s: string) => s.replace(/\s+/g, ' ').trim();
const ESCRITURA = /^(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|TRUNCATE|REPLACE|GRANT|REVOKE|RENAME)\b/i;
const etapas = nombres.filter(n => /^\d+-etapa\d/.test(n)), verificaciones = nombres.filter(n => /^\d+-verificar/.test(n));
const SOLO_LECTURA = [...verificaciones, '00-prueba-comportamiento-errores-solo-lectura.sql', '15-recuperacion-solo-lectura.sql'];
const TRIGGER = '12-etapa6-reemplazar-trigger.sql';
/** Separa sentencias como el cliente: por `;` (o por `//` en la etapa del trigger, cuyo cuerpo contiene `;`). */
const partir = (archivo: string) => (archivo === TRIGGER ? ejecutable(archivos[archivo]).split(/\/\/\s*\n?/) : ejecutable(archivos[archivo]).split(/;\s*\n/)).map(x => x.trim()).filter(Boolean);
/** DDL incrustada en el PREPARE condicionado de una etapa 1-5 (se deshace el doble apóstrofo del literal). */
const ddlIncrustada = (archivo: string) => { const m = ejecutable(archivos[archivo]).match(/,\n'((?:[^']|'')*)',\n'SELECT \(SELECT ''DETENER/); expect(m, archivo).not.toBeNull(); return m![1].replace(/''/g, "'"); };

describe('instalación manual por etapas (phpMyAdmin): archivos SQL generados', () => {
  it('los archivos versionados son exactamente los que genera el script desde las fuentes auditadas (sin deriva)', () => {
    expect(readdirSync(DIR_SALIDA).sort()).toEqual([...nombres].sort());
    for (const n of nombres) expect(readFileSync(`${DIR_SALIDA}/${n}`, 'utf8'), n).toBe(archivos[n]);
  });
  it('son 16 archivos: prueba de errores (00), 6 etapas de escritura, 8 verificaciones y recuperación (15), todos numerados', () => {
    expect(nombres).toHaveLength(16);
    expect(etapas).toHaveLength(6); expect(verificaciones).toHaveLength(8);
    expect(nombres.map(n => n.slice(0, 2))).toEqual(Array.from({ length: 16 }, (_, i) => String(i).padStart(2, '0')));
  });
  it('fidelidad: la sentencia de cada etapa es EXACTAMENTE la de sql/migrate-2026-11-canecas-simplificacion-wip.sql (salvo el esquema explícito)', () => {
    const m = sentenciasMigracion();
    const esperado: Record<string, string> = { '02-etapa1-crear-secuencias.sql': m.secuencias, '04-etapa2-sembrar-contadores.sql': m.siembra, '06-etapa3-alterar-ventas.sql': m.ventas, '08-etapa4-alterar-productos.sql': m.productos, '10-etapa5-alterar-compras.sql': m.compras };
    for (const [archivo, original] of Object.entries(esperado)) expect(compactar(desCalificar(ddlIncrustada(archivo))), archivo).toBe(compactar(original));
    const trigger = partir(TRIGGER).find(x => /^CREATE OR REPLACE TRIGGER/.test(x))!;
    expect(compactar(desCalificar(trigger))).toBe(compactar(m.trigger));
  });
  it('conserva íntegros el CHECK, los índices únicos, las columnas virtuales y el trigger de la migración', () => {
    const todo = etapas.map(n => archivos[n]).join('\n');
    for (const fragmento of ['CONSTRAINT chk_can_venta_direccion CHECK (direccion_entrega IS NULL OR CHAR_LENGTH(TRIM(direccion_entrega)) > 0)', 'ADD UNIQUE KEY uq_can_venta_doc_auto (empresa_id,doc_auto)', 'ADD UNIQUE KEY uq_can_producto_activo_unico (empresa_id,activo_unico)', 'ADD UNIQUE KEY uq_can_compra_ref_auto (empresa_id,ref_auto)', "GENERATED ALWAYS AS (IF(documento REGEXP '^VTA-[0-9]{6,15}$', documento, NULL)) VIRTUAL".replace(/'/g, "''"), "GENERATED ALWAYS AS (IF(referencia REGEXP '^COMP-[0-9]{6,15}$', referencia, NULL)) VIRTUAL".replace(/'/g, "''"), 'GENERATED ALWAYS AS (IF(activo = 1, 1, NULL)) VIRTUAL', 'OR NOT (NEW.direccion_entrega <=> OLD.direccion_entrega)', "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_INMUTABLE'", 'CREATE OR REPLACE TRIGGER', 'COALESCE(h.maximo, 0)', "REGEXP ''^COMP[ _-]?[0-9]{1,15}$''"]) expect(todo, fragmento).toContain(fragmento);
  });
  it('cada referencia a tabla o trigger lleva el esquema explícito: sin USE, sin DATABASE() y sin tablas sin calificar (también en prueba y recuperación)', () => {
    for (const n of nombres) {
      const sql = ejecutable(archivos[n]);
      expect(sql, n).not.toMatch(/\bUSE\s/i);
      expect(sql, n).not.toMatch(/DATABASE\(\)/i);
      expect(sql, n).not.toMatch(/\b(FROM|JOIN|INTO|TABLE|REFERENCES|ON)\s+(canecas_\w+|empresas)\b/);
      expect(sql, n).not.toMatch(/TRIGGER\s+trg_/);
      for (const m of sql.matchAll(/(?:TABLE_SCHEMA|TRIGGER_SCHEMA|CONSTRAINT_SCHEMA)\s*=\s*'([^']+)'/g)) expect(m[1]).toBe(BASE);
      for (const m of sql.matchAll(/`([^`]+)`\.\w+/g)) expect(m[1]).toBe(BASE);
    }
  });
  it('seguridad: sin DROP, TRUNCATE, DELETE, GRANT ni desactivar claves foráneas/CHECK; solo ASCII', () => {
    for (const n of nombres) {
      const sql = ejecutable(archivos[n]);
      expect(sql, n).not.toMatch(/\b(DROP TABLE|DROP INDEX|DROP COLUMN|DROP TRIGGER|TRUNCATE|RENAME)\b|DELETE\s+FROM|GRANT|REVOKE|FLUSH/i);
      expect(sql, n).not.toMatch(/SET\s+(SESSION\s+|@@(SESSION\.)?)?(foreign_key_checks|check_constraint_checks)/i); // solo se LEEN (@@SESSION.x), nunca se asignan
      expect(archivos[n], n).toMatch(/^[\x00-\x7f]*$/);
    }
  });
  it('los archivos de solo lectura (verificaciones, prueba de errores y recuperación) contienen únicamente SELECT (y SET SESSION group_concat_max_len)', () => {
    for (const n of SOLO_LECTURA) {
      for (const s of ejecutable(archivos[n]).split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) {
        if (/^SET SESSION group_concat_max_len = 1048576;?$/.test(s)) continue;
        expect(s, n).toMatch(/^SELECT\b/); expect(s, n).not.toMatch(ESCRITURA);
      }
    }
  });
  describe('modos estrictos (hallazgo 2): en la misma sesión de cada etapa de escritura, equivalentes al instalador oficial', () => {
    it('cada etapa fija STRICT_TRANS_TABLES e innodb_strict_mode=1 SIN perder los modos previos, y los restaura al final', () => {
      expect(PROLOGO_MODOS[1]).toContain("CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES')"); // añade, nunca reemplaza (igual que el instalador)
      for (const n of etapas) {
        const s = partir(n).map(x => x.replace(/;$|\/\/$/, '').trim());
        expect(s.slice(0, 3), n).toEqual(PROLOGO_MODOS);
        expect(s.slice(-2), n).toEqual(EPILOGO_MODOS);
        expect(s.indexOf('SHOW WARNINGS'), n).toBeGreaterThan(2); // cero advertencias comprobables tras la DDL
      }
    });
    it('exige (en la propia condición) SQL estricto, innodb_strict_mode, foreign_key_checks y check_constraint_checks activos; si no, la DDL no existe', () => {
      for (const parte of ['@@SESSION.foreign_key_checks = 1', '@@SESSION.check_constraint_checks = 1', '@@SESSION.innodb_strict_mode = 1', "FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode) > 0", "FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0"]) expect(MODOS_OK).toContain(parte);
      for (const n of etapas) expect(ejecutable(archivos[n]), n).toContain(MODOS_OK);
    });
  });
  describe('guardas (hallazgo 4): no se puede ejecutar una etapa si falla una comprobación, aunque el cliente continúe tras un error', () => {
    it('etapas 1-5: la DDL va dentro de un PREPARE condicionado; con la condición falsa lo ejecutado es una subconsulta que falla (1242)', () => {
      for (const n of etapas.filter(x => x !== TRIGGER)) {
        const sql = ejecutable(archivos[n]);
        expect(sql, n).toMatch(/SET @etapa_sql = IF\(\n[\s\S]+?,\n'(?:[^']|'')*',\n'SELECT \(SELECT ''DETENER[^']*(?:''[^']*)*'' UNION ALL SELECT ''ejecute \d\d-verificar[^']*(?:''[^']*)*''\)'\);/);
        expect(partir(n).filter(x => ESCRITURA.test(x)), n).toEqual([]); // ninguna DDL suelta fuera del literal
        const orden = ['PREPARE etapa_stmt FROM @etapa_sql', 'EXECUTE etapa_stmt', 'SHOW WARNINGS', 'DEALLOCATE PREPARE etapa_stmt'].map(x => sql.indexOf(x));
        expect(orden.every((x, i) => x > 0 && (i === 0 || x > orden[i - 1])), n).toBe(true);
      }
    });
    it('etapa 6 (trigger): no admite PREPARE; su límite está declarado y lleva guarda de mejor esfuerzo; las otras etapas no tienen DDL suelta', () => {
      expect(archivos[TRIGGER]).toContain('NO tiene guarda intrinseca');
      expect(partir(TRIGGER).filter(x => ESCRITURA.test(x)).map(x => x.split(/\s/).slice(0, 5).join(' '))).toEqual(['CREATE OR REPLACE TRIGGER `u611730801_Plataforma`.trg_can_venta_bu']);
      expect(partir(TRIGGER).some(x => /^SELECT CASE WHEN [\s\S]* THEN 'GUARDA OK etapa 6'/.test(x))).toBe(true);
      expect(ejecutable(archivos[TRIGGER]).trimEnd().endsWith('//')).toBe(true);
    });
    it('cada guarda cita la verificación de solo lectura de la etapa previa', () => {
      const previa: Record<string, string> = { '02-': '01-verificar-previo.sql', '04-': '03-verificar-etapa1.sql', '06-': '05-verificar-etapa2.sql', '08-': '07-verificar-etapa3.sql', '10-': '09-verificar-etapa4.sql', '12-': '11-verificar-etapa5.sql' };
      for (const n of etapas) expect(archivos[n], n).toContain(previa[n.slice(0, 3)]);
    });
    it('la prueba controlada de comportamiento ante errores es de solo lectura y falla a propósito en la 2.ª sentencia', () => {
      const s = partir('00-prueba-comportamiento-errores-solo-lectura.sql');
      expect(s).toHaveLength(3);
      expect(s[1]).toBe("SELECT (SELECT 'error intencional' UNION ALL SELECT 'de la prueba') AS error_intencional");
      expect(s[2]).toContain('DESPUES DEL ERROR');
    });
  });
  describe('GROUP_CONCAT (hallazgo 3): las huellas no dependen de group_concat_max_len', () => {
    it('ninguna huella usa GROUP_CONCAT; son conteo y dos sumas exactas de 64 bits por fila', () => {
      for (const n of nombres.filter(x => /^(03|05|07|09|11|13)-/.test(x))) expect(archivos[n], n).not.toMatch(/GROUP_CONCAT/i);
      const final = archivos['14-verificar-final.sql'];
      expect(final).toContain("CAST(CONV(SUBSTRING(MD5(x), 1, 16), 16, 10) AS DECIMAL(65,0))");
      expect(final).toContain("CAST(CONV(SUBSTRING(MD5(x), 17, 16), 16, 10) AS DECIMAL(65,0))");
      expect(final.match(/huella exacta/g)).toHaveLength(20);
      for (const m of final.matchAll(/='(\d+:\d+:\d+)', 'OK'/g)) expect(m[1]).toMatch(/^\d+:\d+:\d+$/);
    });
    it('el único archivo que conserva GROUP_CONCAT (solo informativo, del preflight original) fija y exige group_concat_max_len >= 1048576 en su sesión', () => {
      const conGroupConcat = nombres.filter(n => /GROUP_CONCAT/i.test(ejecutable(archivos[n])));
      expect(conGroupConcat).toEqual(['01-verificar-previo.sql']);
      const s = partir('01-verificar-previo.sql');
      expect(s[0]).toBe('SET SESSION group_concat_max_len = 1048576');
      expect(s[1]).toContain('@@SESSION.group_concat_max_len >= 1048576');
    });
  });
  it('el preflight y el postcheck de origen se conservan completos (22 y 15) y las verificaciones por tabla incluyen sus 5 secciones del contrato', () => {
    expect((ejecutable(archivos['01-verificar-previo.sql']).match(/^SELECT /gm) ?? [])).toHaveLength(23); // 22 originales + comprobación de group_concat_max_len
    for (const t of ['canecas_secuencias', 'canecas_ventas', 'canecas_productos', 'canecas_compras']) for (const s of ['tablas', 'columnas', 'indices', 'foraneas', 'checks']) expect(archivos['14-verificar-final.sql']).toContain(`'contrato ${s} de ${t} (huella exacta)'`);
    expect(archivos['14-verificar-final.sql']).toContain("'trigger trg_can_venta_bu exacto");
    expect(archivos['14-verificar-final.sql']).toContain("'trigger trg_can_venta_bd exacto");
    expect(archivos['13-verificar-etapa6.sql']).toContain("BINARY 'BEGIN IF NOT (NEW.id <=> OLD.id)");
    expect(archivos['13-verificar-etapa6.sql']).toContain("BINARY 'BEGIN SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''CANECAS_VENTA_NO_ELIMINABLE''; END'");
    expect(archivos['13-verificar-etapa6.sql']).not.toMatch(/BINARY 'CREATE/);
  });
  it('recuperación (hallazgo 1): estado por etapa y mapa de reversión con esquema explícito, sin DATABASE() ni tablas sin calificar', () => {
    const r = archivos['15-recuperacion-solo-lectura.sql'];
    expect(r).toContain("funciona con information_schema seleccionada");
    for (const etapa of ['etapa 1:', 'etapa 3:', 'etapa 4:', 'etapa 5:', 'etapa 6:']) expect(r).toContain(etapa);
    expect(r).toContain('FROM `u611730801_Plataforma`.canecas_secuencias'); // la tabla de contadores se consulta calificada
    expect(r).toContain('ALTER TABLE `u611730801_Plataforma`.canecas_compras DROP INDEX uq_can_compra_ref_auto');
    expect(ejecutable(r)).not.toMatch(/DATABASE\(\)/);
  });
  it('calificar/desCalificar son inversos y no tocan literales de texto', () => {
    const original = "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_NAME='canecas_secuencias'";
    expect(calificar(original)).toBe(original);
    const consulta = 'SELECT 1 FROM canecas_ventas v JOIN empresas e ON 1=1';
    expect(desCalificar(calificar(consulta))).toBe(consulta);
    expect(calificar(consulta)).toContain('`u611730801_Plataforma`.canecas_ventas');
  });
});
