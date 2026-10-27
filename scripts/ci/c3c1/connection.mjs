import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { validarManifiesto, validarOpciones, opcionesPipe, verificarConexion, aprobarControles, sentencias } from './safety.mjs';

export function leerManifiesto(file) {
  const absoluto = path.resolve(file);
  const dir = path.dirname(absoluto);
  if (path.basename(absoluto) !== 'manifest.json' || !/^novalvion-c3c1-[a-f0-9]{32}$/.test(path.basename(dir)) ||
      path.dirname(dir) !== path.resolve(os.tmpdir())) throw Error('No se acepta un manifiesto externo');
  const m = validarManifiesto(JSON.parse(fs.readFileSync(absoluto, 'utf8')), os.tmpdir());
  if (path.resolve(m.runDir) !== dir || fs.realpathSync(dir) !== dir || fs.realpathSync(m.datadir) !== path.resolve(m.datadir)) throw Error('Ruta redirigida');
  return m;
}
export function comprobarPid(m) {
  if (Number(fs.readFileSync(m.pidFile, 'utf8').trim()) !== m.pid) throw Error('PID de otra instancia');
  process.kill(m.pid, 0); // Solo comprobar existencia. No detiene procesos.
}
export async function conectarRaw(m, base = true) {
  validarManifiesto(m, os.tmpdir());
  const opts = opcionesPipe(m, base); validarOpciones(opts, m);
  const c = await mysql.createConnection(opts);
  try { await verificarConexion(c, m, comprobarPid, base); return c; }
  catch (e) { await c.end(); throw e; }
}
/** Cada operación revalida instancia y marca de base; getPool de aplicación nunca se usa. */
export function crearPoolLaboratorio(m) {
  validarManifiesto(m, os.tmpdir());
  const opts = opcionesPipe(m); validarOpciones(opts, m);
  const pool = mysql.createPool({ ...opts, connectionLimit: 6 });
  return {
    async getConnection() {
      const c = await pool.getConnection();
      try { await verificarConexion(c, m, comprobarPid); }
      catch (e) { c.destroy(); throw e; }
      return new Proxy(c, {
        get(target, key) {
          if (['query', 'execute', 'beginTransaction', 'commit', 'rollback'].includes(String(key))) return async (...args) => {
            await verificarConexion(c, m, comprobarPid);
            if (typeof args[0] === 'string' && (/^\s*(USE|SHUTDOWN|DROP\s+DATABASE|CREATE\s+DATABASE)\b/i.test(args[0]) || /^\s*SET\b[\s\S]*(FOREIGN_KEY_CHECKS|CHECK_CONSTRAINT_CHECKS)/i.test(args[0]))) throw Error('Operación fuera del contrato de pruebas');
            return target[key](...args);
          };
          const valor = target[key]; return typeof valor === 'function' ? valor.bind(target) : valor;
        },
      });
    },
    async end() { await pool.end(); },
  };
}
export async function controles(c, sql) {
  const lista = sentencias(sql);
  if (!lista.length || lista.some((s) => !/^SELECT\b/i.test(s))) throw Error('Artefacto de controles inválido');
  for (const s of lista) { const [rows] = await c.query(s); aprobarControles(rows); }
}
