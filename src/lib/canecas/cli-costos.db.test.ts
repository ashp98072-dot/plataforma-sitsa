import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verificarClavesForaneas, verificarTriggers } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';
import { verificarContrato } from '../../../scripts/ci/canecas/contrato-costos.mjs';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('CLI contra MariaDB desechable', () => {
  const db = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_cli_test', multipleStatements: true });
  beforeAll(async () => {
    const schema = readFileSync('sql/schema.sql', 'utf8');
    for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
      const def = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!def) throw Error(`Falta ${tabla}`);
      await db.query(def[0]);
    }
    await db.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
    const [diagnostico] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/diagnostico-lectura-2026-11-canecas-fifo.sql', 'utf8'));
    expect(diagnostico[0][0].version_servidor).toContain('11.8.9-MariaDB');
    expect(diagnostico[1][0].veredicto_version).toContain('VERSION ENSAYADA');
  });
  afterAll(async () => { await db.end(); });
  it('ejecuta el instalador una vez y bloquea el reintento sin cambiar el esquema', async () => {
    const env = { ...process.env, CANECAS_SQL_PIPE: pipe, CANECAS_SQL_DATABASE: 'canecas_cli_test', CANECAS_SQL_USER: 'fifo_lab', CANECAS_SQL_PASSWORD: 'fifo-lab-only' };
    const run = () => spawnSync(process.execPath, ['scripts/ci/canecas/ejecutar-costos-controlado.mjs', '--ejecutar'], { env, encoding: 'utf8', timeout: 30000 });
    const ddlInspection = "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION";
    const [beforePermissions] = await db.query(ddlInspection);
    for (let i = 0; i < 6; i++) {
      const insufficient = spawnSync(process.execPath, ['scripts/ci/canecas/ejecutar-costos-controlado.mjs', '--ejecutar'], { env: { ...env, CANECAS_SQL_USER: `fifo_missing_${i}`, CANECAS_SQL_PASSWORD: 'fifo-test-only' }, encoding: 'utf8', timeout: 30000 });
      expect(insufficient.status).not.toBe(0);
      expect(insufficient.stderr).toContain('DETENER');
      expect((await db.query(ddlInspection))[0]).toEqual(beforePermissions);
    }
    const first = run();
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('postcheck completos');
    await expect(verificarContrato(db)).resolves.toBeUndefined();
    await db.query("ALTER TABLE canecas_gastos_posteriores COMMENT='modificado'");
    await expect(verificarContrato(db)).rejects.toThrow('tablas');
    await db.query("ALTER TABLE canecas_gastos_posteriores COMMENT=''");
    await db.query("ALTER TABLE canecas_gastos_posteriores MODIFY COLUMN referencia VARCHAR(250) NOT NULL COMMENT 'modificado'");
    await expect(verificarContrato(db)).rejects.toThrow('columnas');
    await db.query('ALTER TABLE canecas_gastos_posteriores MODIFY COLUMN referencia VARCHAR(250) NOT NULL');
    await db.query('ALTER TABLE canecas_gastos_posteriores MODIFY COLUMN referencia VARCHAR(240) NOT NULL');
    await expect(verificarContrato(db)).rejects.toThrow('columnas');
    await db.query('ALTER TABLE canecas_gastos_posteriores MODIFY COLUMN referencia VARCHAR(250) NOT NULL');
    await db.query('ALTER TABLE canecas_gastos_posteriores DROP INDEX uq_can_gasto_clave');
    await db.query('ALTER TABLE canecas_gastos_posteriores ADD UNIQUE INDEX uq_can_gasto_clave (clave_operacion,empresa_id)');
    await expect(verificarContrato(db)).rejects.toThrow('indices');
    await db.query('ALTER TABLE canecas_gastos_posteriores DROP INDEX uq_can_gasto_clave');
    await db.query('ALTER TABLE canecas_gastos_posteriores ADD UNIQUE INDEX uq_can_gasto_clave (empresa_id,clave_operacion)');
    await db.query('ALTER TABLE canecas_gastos_posteriores DROP CONSTRAINT chk_can_gasto_positivo');
    await db.query('ALTER TABLE canecas_gastos_posteriores ADD CONSTRAINT chk_can_gasto_positivo CHECK (importe_centavos > 0)');
    await expect(verificarContrato(db)).rejects.toThrow('checks');
    await db.query('ALTER TABLE canecas_gastos_posteriores DROP CONSTRAINT chk_can_gasto_positivo');
    await db.query('ALTER TABLE canecas_gastos_posteriores ADD CONSTRAINT chk_can_gasto_positivo CHECK (importe_centavos >= 0)');
    await db.query('ALTER TABLE canecas_gastos_posteriores DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
    await expect(verificarContrato(db)).rejects.toThrow('tablas');
    await db.query('ALTER TABLE canecas_gastos_posteriores DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    const [before] = await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME');
    const second = run();
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('DETENER');
    expect((await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME'))[0]).toEqual(before);
    const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
    const triggers = migration.split('DELIMITER //')[1].split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'));
    const [post] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/postcheck-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(() => verificarTriggers(post[8], triggers)).not.toThrow();
    expect(() => verificarClavesForaneas(post[9], migration)).not.toThrow();
    await db.query('ALTER TABLE canecas_valoraciones_iniciales DROP FOREIGN KEY fk_can_val_producto');
    await db.query('ALTER TABLE canecas_valoraciones_iniciales ADD CONSTRAINT fk_can_val_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_ubicaciones(empresa_id,id)');
    const [fkAlterada] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/postcheck-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(() => verificarClavesForaneas(fkAlterada[9], migration)).toThrow('definición incompatible');
    await db.query('DROP TRIGGER can_valoracion_no_borrar');
    await db.query('CREATE TRIGGER can_valoracion_no_borrar BEFORE DELETE ON canecas_valoraciones_iniciales FOR EACH ROW BEGIN SET @invalido=1; END');
    const [alterado] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/postcheck-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(() => verificarTriggers(alterado[8], triggers)).toThrow('definición incompatible');
  }, 30000);
});
