import { readFileSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { ejecutarOperacionesDDL } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

// Exclusivo para pruebas: no modifica el instalador ni su contrato de seguridad.
export async function prepararCostosLaboratorio(connection: mysql.PoolConnection, pipe: string | undefined, base: string) {
  if (!pipe || !/^fifo-[0-9a-f-]{36}$/.test(pipe) || !['canecas_fifo_test', 'canecas_cli_test'].includes(base)) throw Error('Laboratorio no identificado');
  const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT DATABASE() base, @@socket socket, @@datadir datadir, VERSION() version');
  const identity = rows[0];
  const root = path.resolve('../.lab-runtime').toLowerCase();
  const actual = path.resolve(String(identity.datadir)).toLowerCase();
  const relative = path.relative(root, actual).replaceAll('\\', '/');
  if (identity.base !== base || identity.socket !== pipe || !String(identity.version).startsWith('11.8.9-MariaDB') || !/^fifo-lab-[0-9a-f-]{36}\/data$/.test(relative)) throw Error('Identidad de laboratorio incompatible');
  const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
  const [ddl, triggers, extra] = migration.split('DELIMITER //');
  if (!triggers || extra || !triggers.includes('DELIMITER ;')) throw Error('Formato de migración incompatible');
  const statements = ddl.split(';').map(x => x.trim()).filter(Boolean);
  const triggerStatements = triggers.split('//').map(x => x.trim()).filter(x => x.startsWith('CREATE TRIGGER'));
  if (statements.length !== 5 || triggerStatements.length !== 7) throw Error('DDL de laboratorio incompleto');
  await ejecutarOperacionesDDL(connection, [...statements, ...triggerStatements]);
}

