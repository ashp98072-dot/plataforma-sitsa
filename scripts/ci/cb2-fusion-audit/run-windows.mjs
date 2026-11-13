// Laboratorio desechable: nunca carga .env, nunca usa TCP ni directorios anteriores.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
if (process.platform !== 'win32' || args.length !== 3 || args[0] !== '--run-isolated')
  throw Error('Uso: --run-isolated <engine-home> <engine-manifest.json>');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(repo);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const manifestBytes = fs.readFileSync(path.resolve(args[2]));
if (sha(manifestBytes) !== '73760fd391d41181a20c2074111227f1073c13bdc4626d25605b711c304fbeea') throw Error('Manifest no verificado');
const manifest = JSON.parse(manifestBytes), home = fs.realpathSync(path.resolve(args[1]));
if (sha(fs.readFileSync(home + '.zip')) !== manifest.zipSha256) throw Error('ZIP no verificado');
for (const [name, digest] of Object.entries(manifest.files)) {
  const target = path.resolve(home, name);
  if (!target.startsWith(home + path.sep) || fs.lstatSync(target).isSymbolicLink() || sha(fs.readFileSync(target)) !== digest)
    throw Error(`Motor no verificado: ${name}`);
}
const inventory = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (e.isSymbolicLink()) throw Error('Enlace en motor');
  return e.isDirectory() ? inventory(path.join(dir, e.name)) : [path.relative(home, path.join(dir, e.name)).replaceAll('\\', '/')];
});
if (JSON.stringify(inventory(home).sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) throw Error('Inventario no coincide');
const parent = path.resolve('.lab-runtime'); fs.mkdirSync(parent, { recursive: true });
if (fs.lstatSync(parent).isSymbolicLink()) throw Error('Raiz de laboratorio enlazada');
const run = path.join(parent, `cb2-587-${crypto.randomUUID()}`); fs.mkdirSync(run);
const data = path.join(run, 'data'), pipe = `cb2-587-${crypto.randomUUID()}`, bin = n => path.join(home, 'bin', n + '.exe');
const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: run, TMP: run,
  PATH: `${path.join(home, 'bin')};${process.env.SystemRoot}\\System32` };
const record = (name, value) => fs.writeFileSync(path.join(run, name + '.json'), JSON.stringify(value, null, 2));
record('guards', { home, run, data, pipe, engineFiles: manifest.fileCount, network: 'skip-networking; PIPE only', d2: 'child laboratory only' });
const init = cp.spawnSync(bin('mariadb-install-db'), [`--datadir=${data}`, `--socket=${pipe}`, '--skip-networking'], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
record('init', { status: init.status, stdout: init.stdout, stderr: init.stderr });
if (init.status !== 0) throw Error('Inicializacion fallida');
const fd = fs.openSync(path.join(run, 'server.log'), 'wx');
const server = cp.spawn(bin('mariadbd'), ['--no-defaults', `--basedir=${home}`, `--datadir=${data}`, '--skip-networking', '--enable-named-pipe', `--socket=${pipe}`, '--innodb-buffer-pool-size=64M', '--console'], { env, stdio: ['ignore', fd, fd], windowsHide: true });
fs.closeSync(fd);
const clientArgs = ['--no-defaults', '--protocol=PIPE', '--host=.', `--socket=${pipe}`, '-uroot', '--batch', '--skip-column-names'];
const sql = input => cp.spawnSync(bin('mariadb'), clientArgs, { env, input, encoding: 'utf8', windowsHide: true, timeout: 5000 });
let verified = false;
try {
  let ready;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error('Servidor termino antes de estar disponible');
    ready = sql('SELECT VERSION(),@@skip_networking,@@socket,@@datadir;');
    if (ready.status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (ready?.status !== 0) throw Error('Servidor no disponible');
  const [version, net, socket, dir] = ready.stdout.trim().split('\t');
  if (!version.startsWith('11.8.9-MariaDB') || net !== '1' || socket !== pipe || path.resolve(dir).toLowerCase() !== data.toLowerCase()) throw Error('Identidad de servidor incompatible');
  verified = true;
  record('server', { pid: server.pid, version, net, socket, dir });
  const test = cp.spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.resolve('vitest/package.json'))), 'vitest.mjs'), 'run', 'src/lib/flota/cb2/terceros.db.test.ts', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile=${path.join(run, 'vitest.json')}`], {
    env: { ...env, CB2_587_PIPE: pipe, CB2_587_DATA: data }, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  record('tests', { status: test.status, stdout: test.stdout, stderr: test.stderr });
  console.log(test.stdout, test.stderr); process.exitCode = test.status === 0 ? 0 : 1;
} finally {
  // Solo el pipe aleatorio de la instancia creada por este proceso. Ningun servicio ni proceso ajeno.
  const stop = verified ? sql('SHUTDOWN;') : null;
  if (stop?.status !== 0 && server.exitCode === null) server.kill();
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  record('shutdown', { status: stop?.status, pid: server.pid, exitCode: server.exitCode });
  console.log('Laboratorio conservado:', run);
  if (stop?.status !== 0 || server.exitCode === null) process.exitCode = 1;
}
