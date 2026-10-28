// NO ejecutar sin autorización. Importar este archivo no inicia el laboratorio.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { observarServidor, cerrarServidor } from './lifecycle.mjs';
import { validarManifiesto, configuracionInicializador, opcionesPipe, validarOpciones, verificarConexion, prepararMigracion, sentencias } from './safety.mjs';
import { comprobarPid, conectarRaw, crearPoolLaboratorio, controles } from './connection.mjs';

export async function ejecutarLaboratorio(args) {
  if (process.platform !== 'win32' || args[0] !== '--run-isolated' ||
      !(args.length === 1 || (args.length === 2 && args[1] === '--concurrency-only'))) throw Error('Requiere Windows y --run-isolated [--concurrency-only]');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const home = path.join(repo, '.lab-runtime/mariadb-11.8.9-winx64');
  const zip = path.join(repo, '.lab-runtime/mariadb-11.8.9-winx64.zip');
  if (crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex') !== '830c46727d9278eae212ae3eca44eeb9e71b2a68704e95f344a64fba7b1963f5') throw Error('Distribución MariaDB inesperada');
  for (const b of ['mariadbd', 'mariadb-install-db']) if (!fs.existsSync(path.join(home, 'bin', `${b}.exe`))) throw Error('Binario no disponible');
  const id = crypto.randomUUID().replaceAll('-', '');
  const runDir = path.join(os.tmpdir(), `novalvion-c3c1-${id}`);
  fs.mkdirSync(runDir); // Sin recursive: si ya existe, se detiene. Nunca reutiliza un datadir.
  const m = { id, database: `c3c1_lab_${id}`, pipe: `c3c1-${id}`, token: crypto.randomBytes(32).toString('hex'), runDir, datadir: path.join(runDir, 'data'), pidFile: path.join(runDir, 'server.pid'), pid: 1 };
  // La raíz temporal debe coincidir en padre e hijo para validar el manifiesto.
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: os.tmpdir(), TMP: os.tmpdir(), PATH: `${path.join(home, 'bin')};${process.env.SystemRoot}\\System32`, NODE_ENV: 'test' };
  // El inicializador Windows no acepta --no-defaults. Solo nuestra plantilla nueva,
  // sin includes: internamente usa --defaults-file=data/my.ini para el bootstrap.
  const inicializador = configuracionInicializador(m, os.tmpdir());
  if (fs.existsSync(m.datadir)) throw Error('Datadir preexistente; inicialización prohibida');
  fs.writeFileSync(inicializador.archivo, inicializador.contenido, { flag: 'wx' });
  const init = cp.spawnSync(path.join(home, 'bin/mariadb-install-db.exe'), inicializador.args, { cwd: runDir, env, windowsHide: true, encoding: 'utf8' });
  if (init.status !== 0) { fs.writeFileSync(path.join(runDir, 'init.log'), `${init.stdout}\n${init.stderr}`); throw Error('Inicialización fallida; no se intenta fallback'); }
  const log = fs.openSync(path.join(runDir, 'server.log'), 'wx');
  const server = cp.spawn(path.join(home, 'bin/mariadbd.exe'), ['--no-defaults', `--basedir=${home}`, `--datadir=${m.datadir}`, `--pid-file=${m.pidFile}`, '--skip-networking', '--enable-named-pipe', `--socket=${m.pipe}`, '--sql-mode=STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE', '--innodb-buffer-pool-size=64M', '--console'], { env, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  const ownedServer = observarServidor(server,runDir);
  let spawnError;
  server.on('error', (error) => { spawnError = error; });
  m.pid = server.pid ?? 0;
  let pool, functionalError;
  try {
    validarManifiesto(m, os.tmpdir());
    let admin;
    for (let i = 0; i < 60; i++) {
      if (spawnError || server.exitCode !== null) throw Error('Servidor temporal terminado o no disponible');
      try { admin = await conectarRaw(m, false); break; }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!admin) throw Error('No se pudo verificar la instancia temporal');
    try {
      const [r] = await admin.query('SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [m.database]);
      if (Number(r[0].n) !== 0) throw Error('Base preexistente; no se reutiliza');
      await verificarConexion(admin, m, comprobarPid, false);
      await admin.query(`CREATE DATABASE \`${m.database}\` CHARACTER SET utf8mb4`);
    } finally { await admin.end(); }
    const opts = opcionesPipe(m); validarOpciones(opts, m);
    const bootstrap = await mysql.createConnection(opts);
    try {
      await verificarConexion(bootstrap, m, comprobarPid, false);
      const [d] = await bootstrap.query('SELECT DATABASE() AS nombre');
      const [t] = await bootstrap.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
      if (d[0].nombre !== m.database || Number(t[0].n) !== 0) throw Error('Base de bootstrap no vacía');
      await verificarConexion(bootstrap, m, comprobarPid, false);
      await bootstrap.query('CREATE TABLE _c3c1_identity (token CHAR(64) NOT NULL PRIMARY KEY) ENGINE=InnoDB');
      await verificarConexion(bootstrap, m, comprobarPid, false);
      await bootstrap.execute('INSERT INTO _c3c1_identity VALUES (?)', [m.token]);
    } finally { await bootstrap.end(); }
    pool = crearPoolLaboratorio(m);
    const c = await pool.getConnection();
    try {
      for (const s of sentencias(fs.readFileSync(path.join(repo, 'scripts/ci/c3c1/fixture.sql'), 'utf8'))) await c.query(s);
      const sql = (tipo) => fs.readFileSync(path.join(repo, `sql/${tipo}-2026-10-contabilidad-calendario-c3c1.sql`), 'utf8');
      await controles(c, sql('preflight'));
      // Se detiene en el primer error; no intenta rollback DDL ni elimina objetos parciales.
      for (const s of prepararMigracion(sql('migrate'), m.database)) await c.query(s);
      await controles(c, sql('postcheck'));
    } finally { c.release(); }
    await pool.end(); pool = undefined;
    const manifest = path.join(runDir, 'manifest.json'); fs.writeFileSync(manifest, JSON.stringify(m), { flag: 'wx' });
    const filtro = args[1] === '--concurrency-only' ? ['--testNamePattern', 'concurrencia C3C-1:'] : [];
    const result = cp.spawnSync(process.execPath, [path.join(repo, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'scripts/ci/c3c1/vitest.config.mts', 'src/lib/contabilidad/calendario.integration.test.ts', '--maxWorkers=1', '--no-file-parallelism', ...filtro], {
      cwd: repo, env: { ...env, C3C1_MANIFEST: manifest }, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(runDir, 'tests.log'), `${result.stdout}\n${result.stderr}`);
    if (result.status !== 0) throw Error('Pruebas reales rechazadas; revisar evidencia del laboratorio');
    fs.writeFileSync(path.join(runDir,'functional-result.json'),JSON.stringify({passed:true,status:result.status}),{flag:'wx'});
  } catch(error) {
    functionalError=error;
    fs.writeFileSync(path.join(runDir,'functional-result.json'),JSON.stringify({passed:false}),{flag:'wx'});
    throw error;
  } finally {
    try { if (pool) await pool.end(); }
    finally {
      let closingConnection;
      try { await cerrarServidor(ownedServer,runDir,async()=>{
        const c=closingConnection=await conectarRaw(m,false);
        await c.query('SHUTDOWN');
      }); } catch(error) {
        if(functionalError)throw new AggregateError([functionalError,error],'Pruebas y apagado rechazados; conservar evidencia');
        throw error;
      } finally { closingConnection?.destroy(); }
    }
    // No DROP DATABASE ni borrados de directorios. Conservar evidencia incluso ante fallo.
  }
  console.log('C3C-1: pruebas y apagado confirmados; evidencia local:', runDir);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  ejecutarLaboratorio(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
