// Laboratorio aislado de Canecas en Linux (CI). Equivalente a run-costos-lab-wip.mjs (Windows):
// mismas bases, usuarios y archivos de prueba. Exige MariaDB 11.8.9 exacto; nunca conecta a Hostinger.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODOS = ['--run-isolated', '--run-isolated-tls', '--run-hostinger-tls'];
if (process.platform !== 'linux' || !MODOS.includes(process.argv[2])) throw Error(`Uso (Linux): ${MODOS.join(' | ')}`);
const hostingerLab = process.argv[2] === '--run-hostinger-tls';
const tlsLab = process.argv[2] === '--run-isolated-tls' || hostingerLab;
const repo = process.cwd();
const shim = fileURLToPath(new URL('./linux-socket-shim.mjs', import.meta.url));
const mariadbd = process.env.CANECAS_LAB_MARIADBD ?? '/usr/sbin/mariadbd';
const installDb = process.env.CANECAS_LAB_INSTALL_DB ?? '/usr/bin/mariadb-install-db';
const client = process.env.CANECAS_LAB_MARIADB ?? '/usr/bin/mariadb';
const basedir = process.env.CANECAS_LAB_BASEDIR ?? '/usr';
for (const bin of [mariadbd, installDb, client]) if (!fs.existsSync(bin)) throw Error(`No existe ${bin}`);
// Motor exacto. La versión se verifica por el binario y otra vez por VERSION() una vez iniciado.
const reportada = cp.execFileSync(mariadbd, ['--version'], { encoding: 'utf8' });
if (!/ Ver 11\.8\.9-MariaDB\b/.test(reportada)) throw Error(`Motor no verificado: ${reportada.trim()}`);
const hashMotor = crypto.createHash('sha256').update(fs.readFileSync(mariadbd)).digest('hex');
if (process.env.CANECAS_LAB_MARIADBD_SHA256 && process.env.CANECAS_LAB_MARIADBD_SHA256 !== hashMotor) throw Error('Hash del motor distinto del fijado');
console.log(`Motor: ${reportada.trim()}\nsha256(mariadbd): ${hashMotor}`);

// Misma disposición que el laboratorio de Windows: las guardas de identidad de las pruebas exigen que el
// datadir sea ../.lab-runtime/fifo-lab-<uuid>/data y que @@socket coincida con el nombre `fifo-<uuid>`.
const root = path.resolve(repo, '../.lab-runtime');
fs.mkdirSync(root, { recursive: true });
if (fs.lstatSync(root).isSymbolicLink()) throw Error('Raíz enlazada');
const run = path.join(root, `fifo-lab-${crypto.randomUUID()}`);
fs.mkdirSync(run, { mode: 0o700 });
const data = path.join(run, 'data'), pipe = `fifo-${crypto.randomUUID()}`;
// mariadbd entra en el datadir y crea ahí el socket relativo `pipe`; la ruta absoluta supera el límite de
// 107 bytes de AF_UNIX, así que los clientes llegan por un enlace corto en un directorio temporal propio.
const corto = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
fs.chmodSync(corto, 0o700);
fs.symlinkSync(data, path.join(corto, 'd'));
const sock = path.join(corto, 'd', pipe);
if (Buffer.byteLength(sock) > 100) throw Error('Ruta de socket demasiado larga');
let port;
if (tlsLab) {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  for (const label of ['server', 'wrong']) {
    const cert = cp.spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(run, `${label}-key.pem`), '-out', path.join(run, `${label}-cert.pem`)], { encoding: 'utf8', timeout: 30000 });
    if (cert.status !== 0) throw Error(`No se pudo generar certificado de prueba ${label}`);
  }
}
const env = { PATH: process.env.PATH, HOME: run, TMPDIR: run, LANG: 'C.UTF-8' };
const comoRoot = process.getuid?.() === 0 ? ['--user=root'] : [];
const init = cp.spawnSync(installDb, ['--no-defaults', `--basedir=${basedir}`, `--datadir=${data}`, '--auth-root-authentication-method=normal', '--skip-test-db', ...comoRoot], { env, encoding: 'utf8', timeout: 120000 });
if (init.status !== 0) throw Error(`Inicialización fallida: ${init.stderr}`);
const fd = fs.openSync(path.join(run, 'server.log'), 'wx');
const networkArgs = tlsLab ? ['--bind-address=127.0.0.1', `--port=${port}`, `--ssl-ca=${path.join(run, 'server-cert.pem')}`, `--ssl-cert=${path.join(run, 'server-cert.pem')}`, `--ssl-key=${path.join(run, 'server-key.pem')}`] : ['--skip-networking'];
const server = cp.spawn(mariadbd, ['--no-defaults', ...comoRoot, `--basedir=${basedir}`, `--datadir=${data}`, ...networkArgs, ...(hostingerLab ? ['--sql-mode=NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', '--innodb-strict-mode=0'] : []), `--socket=${pipe}`, `--pid-file=${path.join(run, 'mariadbd.pid')}`, '--innodb-buffer-pool-size=64M', '--console'], { env, stdio: ['ignore', fd, fd] });
fs.closeSync(fd);
const args = ['--no-defaults', '--protocol=SOCKET', `--socket=${sock}`, '-uroot', '--batch', '--skip-column-names'];
const sql = input => cp.spawnSync(client, args, { env, input, encoding: 'utf8', timeout: 20000 });
let verified = false;
try {
  let ready;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error(`Servidor detenido: ${fs.readFileSync(path.join(run, 'server.log'), 'utf8').slice(-2000)}`);
    ready = sql('SELECT VERSION(),@@skip_networking,@@socket,@@datadir,@@port;');
    if (ready.status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (ready?.status !== 0) throw Error('Servidor no disponible');
  const [version, networkDisabled, socket, dir, actualPort] = ready.stdout.trim().split('\t');
  console.log(`VERSION(): ${version}`);
  if (!version.startsWith('11.8.9-MariaDB') || networkDisabled !== (tlsLab ? '0' : '1') || (tlsLab && Number(actualPort) !== port) || socket !== pipe || path.resolve(dir) !== path.resolve(data)) throw Error('Identidad incorrecta');
  verified = true;
  const permissions = ['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER'];
  const omissions = permissions.map((permission, i) => `CREATE USER 'fifo_missing_${i}'@'localhost' IDENTIFIED BY 'fifo-test-only'; GRANT ${permissions.filter(p => p !== permission).join(',')} ON canecas_cli_test.* TO 'fifo_missing_${i}'@'localhost';`).join(' ');
  if (sql(`CREATE DATABASE canecas_salida_test; CREATE DATABASE canecas_redistribucion_test; CREATE DATABASE canecas_redis_gen_test; CREATE DATABASE canecas_redis_inst_test; CREATE DATABASE canecas_cat_gen_test; CREATE DATABASE canecas_ven_gen_test; CREATE DATABASE canecas_instalacion_test; CREATE DATABASE canecas_fifo_test; CREATE DATABASE canecas_test; CREATE DATABASE canecas_api_test; CREATE DATABASE canecas_schema_test; CREATE DATABASE canecas_recovery_test; CREATE DATABASE canecas_cli_test; CREATE DATABASE canecas_tls_test; CREATE DATABASE canecas_hostinger_test; CREATE DATABASE canecas_warning_test; CREATE USER 'fifo_host'@'localhost' IDENTIFIED BY 'fifo-host-only' REQUIRE SSL; GRANT ${permissions.join(',')} ON canecas_hostinger_test.* TO 'fifo_host'@'localhost'; CREATE USER 'fifo_lab'@'localhost' IDENTIFIED BY 'fifo-lab-only'; GRANT ${permissions.join(',')} ON canecas_cli_test.* TO 'fifo_lab'@'localhost'; CREATE USER 'fifo_tls'@'localhost' IDENTIFIED BY 'fifo-tls-only' REQUIRE SSL; GRANT ${permissions.join(',')} ON canecas_tls_test.* TO 'fifo_tls'@'localhost'; CREATE USER 'fifo_denied'@'localhost' IDENTIFIED BY 'fifo-denied-only' REQUIRE SSL; GRANT SELECT ON canecas_tls_test.* TO 'fifo_denied'@'localhost'; ${omissions}`).status !== 0) throw Error('No se crearon bases desechables');
  const files = hostingerLab ? ['src/lib/canecas/hostinger-modo.db.test.ts', 'src/lib/canecas/instalacion-controlada.db.test.ts', 'src/lib/canecas/salidas-fifo.db.test.ts', 'src/lib/canecas/redistribucion.db.test.ts', 'src/lib/canecas/instalacion-redistribucion.db.test.ts', 'src/lib/canecas/catalogos.db.test.ts', 'src/lib/canecas/instalacion-catalogos.db.test.ts', 'src/lib/canecas/ventas.db.test.ts', 'src/lib/canecas/instalacion-ventas.db.test.ts', 'src/lib/canecas/instalacion-simplificacion.db.test.ts', 'src/lib/canecas/simplificacion.db.test.ts', 'src/lib/canecas/numeracion-historica.db.test.ts', 'src/lib/canecas/diagnostico-previo.db.test.ts', 'src/lib/canecas/instalacion-phpmyadmin.db.test.ts', 'src/lib/canecas/phpmyadmin-bloque.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'redistribucion' ? ['src/lib/canecas/generar-contrato-redistribucion.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'catalogos' ? ['src/lib/canecas/generar-contrato-catalogos.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'ventas' ? ['src/lib/canecas/generar-contrato-ventas.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'simplificacion' ? ['src/lib/canecas/generar-contrato-simplificacion.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === '1' ? ['src/lib/canecas/generar-contrato.db.test.ts'] : ['src/lib/canecas/permisos-reales.db.test.ts', 'src/lib/canecas/interrupciones.db.test.ts', 'src/lib/canecas/tls-costos.db.test.ts', 'src/lib/canecas/cli-costos.db.test.ts', 'src/lib/canecas/recuperacion.db.test.ts', 'src/lib/canecas/costos-fifo.db.test.ts', 'src/lib/canecas/confirmar.db.test.ts', 'src/lib/canecas/flujo.db.test.ts', 'src/lib/canecas/schema.db.test.ts', 'src/lib/canecas/redistribucion.db.test.ts', 'src/lib/canecas/instalacion-redistribucion.db.test.ts', 'src/lib/canecas/catalogos.db.test.ts', 'src/lib/canecas/instalacion-catalogos.db.test.ts', 'src/lib/canecas/ventas.db.test.ts', 'src/lib/canecas/instalacion-ventas.db.test.ts', 'src/lib/canecas/instalacion-simplificacion.db.test.ts', 'src/lib/canecas/simplificacion.db.test.ts', 'src/lib/canecas/numeracion-historica.db.test.ts', 'src/lib/canecas/diagnostico-previo.db.test.ts', 'src/lib/canecas/instalacion-phpmyadmin.db.test.ts'];
  const test = cp.spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mts', ...files, '--maxWorkers=1'], { cwd: repo, env: { ...env, NODE_OPTIONS: `--import ${pathToFileURL(shim).href}`, CANECAS_LAB_UNIX_SOCKET: sock, CANECAS_FIFO_TEST_PIPE: pipe, CANECAS_TEST_PIPE: pipe, CANECAS_REDIS_TEST_SOCKET: sock, ...(process.env.CANECAS_GENERAR_CONTRATO ? { CANECAS_GENERAR_CONTRATO: process.env.CANECAS_GENERAR_CONTRATO } : {}), ...(tlsLab ? { CANECAS_TLS_TEST_PORT: String(port), CANECAS_TLS_TEST_CA: path.join(run, 'server-cert.pem'), CANECAS_TLS_TEST_WRONG_CA: path.join(run, 'wrong-cert.pem') } : {}) }, encoding: 'utf8', timeout: 600000 });
  console.log(test.stdout, test.stderr);
  process.exitCode = test.status === 0 ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  const stop = verified ? sql('SHUTDOWN;') : null;
  if (stop?.status !== 0 && server.exitCode === null) server.kill();
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
  if (server.exitCode === null) { server.kill('SIGKILL'); process.exitCode = 1; }
  console.log('Laboratorio:', run);
  fs.rmSync(corto, { recursive: true, force: true });
  if (!process.env.CANECAS_LAB_CONSERVAR) fs.rmSync(run, { recursive: true, force: true });
}
