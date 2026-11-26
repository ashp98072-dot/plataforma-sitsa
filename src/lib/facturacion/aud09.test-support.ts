// Infraestructura exclusiva de pruebas opt-in; nunca se importa desde código productivo.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { expect } from 'vitest';
import { previsualizarVencimiento } from './credito';
import type { ActorFacturacion } from './facturas';

/** El runner externo arranca una instancia propia y entrega su identidad antes de cualquier DDL. */
export async function verificarLaboratorioAud09(conn: Connection, port: number) {
  const file = process.env.AUD09_LAB_MANIFEST;
  if (!file || !resolve(file).startsWith(resolve(tmpdir()) + sep)) throw new Error('Falta manifiesto de laboratorio AUD09 temporal.');
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (!/^aud09-[a-zA-Z0-9-]+$/.test(basename(m.dir)) || resolve(m.datadir) !== resolve(join(m.dir, 'data')) || !resolve(m.dir).startsWith(resolve(tmpdir()) + sep) || m.port !== port || !/^aud09-[a-f0-9]{32}$/.test(m.pipe)) throw new Error('Manifiesto AUD09 inválido.');
  const [rows] = await conn.query<RowDataPacket[]>('SELECT @@datadir d,@@port p,@@socket s,@@bind_address b,@@version v');
  const r = rows[0];
  if (resolve(r.d) !== resolve(m.datadir) || Number(r.p) !== port || r.s !== m.pipe || r.b !== '127.0.0.1' || !String(r.v).startsWith('11.8.9-MariaDB')) throw new Error('Instancia ajena al laboratorio AUD09. No ejecutar DDL.');
}

/** Ejecuta el SQL versionado sin cambiarlo; DELIMITER es sintaxis del cliente, no del servidor. */
export async function aplicarContratoCreditoAud09(conn: Connection) {
  let delimiter = ';', buffer = '';
  for (const line of readFileSync(join(process.cwd(), 'sql/mil-imp04a/migrate.sql'), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('DELIMITER ')) { delimiter = line.slice(10).trim(); continue; }
    buffer += line + '\n';
    if (line.trimEnd().endsWith(delimiter)) {
      await conn.query(buffer.trimEnd().slice(0, -delimiter.length)); buffer = '';
    }
  }
  if (buffer.trim()) throw new Error('Script MIL04A incompleto.');
  const [rows] = await conn.query<RowDataPacket[]>(readFileSync(join(process.cwd(), 'sql/mil-imp04a/postcheck.sql'), 'utf8'));
  expect(rows[0].estado).toBe('FINAL');
}

export async function tokenEmisionAud09(actor: ActorFacturacion, id: number, fecha: string) {
  const preview = await previsualizarVencimiento(actor, id, fecha);
  expect(preview.certificado).toBe(true);
  if (!preview.certificado) throw new Error('Fixture sin contexto de emisión vigente.');
  return preview.token;
}
