import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('capacidad del bloque de importación MariaDB desechable', () => {
  it('prueba la diferencia entre CREATE TRIGGER directo y mediante PREPARE', async () => {
    const conn = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_warning_test', multipleStatements: true });
    try {
      await conn.query('CREATE TABLE fifo_bloque_lab (id INT PRIMARY KEY)');
      await expect(conn.query("BEGIN NOT ATOMIC CREATE TRIGGER fifo_bloque_trigger BEFORE INSERT ON fifo_bloque_lab FOR EACH ROW SET NEW.id=NEW.id; END")).rejects.toThrow('TRIGGER');
      await conn.query("BEGIN NOT ATOMIC PREPARE s FROM 'CREATE TRIGGER fifo_bloque_trigger BEFORE INSERT ON fifo_bloque_lab FOR EACH ROW SET NEW.id=NEW.id'; EXECUTE s; DEALLOCATE PREPARE s; END");
      const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='fifo_bloque_trigger'");
      expect(rows).toHaveLength(1);
    } finally { await conn.end(); }
  });
});
