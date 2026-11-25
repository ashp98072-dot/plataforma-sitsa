import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';

if (process.platform !== 'win32' || !['--run-isolated', '--run-isolated-tls', '--run-hostinger-tls'].includes(process.argv[2])) throw Error('Usar --run-isolated, --run-isolated-tls o --run-hostinger-tls');
const hostingerLab = process.argv[2] === '--run-hostinger-tls';
const tlsLab = process.argv[2] === '--run-isolated-tls' || hostingerLab;
const repo = process.cwd();
const engine = fs.realpathSync(path.resolve(repo, '../.lab-runtime/mariadb-11.8.9-winx64'));
const bin = name => path.join(engine, 'bin', `${name}.exe`);
const hash = crypto.createHash('sha256').update(fs.readFileSync(bin('mariadbd'))).digest('hex');
if (hash !== 'de2c4350e36bcdff6a18b614a21701a8a827509f44f51274411bb52a2849f9e5') throw Error('Motor no verificado');
const root = path.resolve(repo, '../.lab-runtime');
if (fs.lstatSync(root).isSymbolicLink()) throw Error('Raíz enlazada');
const run = path.join(root, `fifo-lab-${crypto.randomUUID()}`);
fs.mkdirSync(run);
const data = path.join(run, 'data'), pipe = `fifo-${crypto.randomUUID()}`;
const openssl = 'C:/Program Files/Git/mingw64/bin/openssl.exe';
let port;
if (tlsLab) {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  for (const label of ['server', 'wrong']) {
    const cert = cp.spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(run, `${label}-key.pem`), '-out', path.join(run, `${label}-cert.pem`)], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    if (cert.status !== 0) throw Error(`No se pudo generar certificado de prueba ${label}`);
  }
}
const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: run, TMP: run, PATH: `${path.join(engine, 'bin')};${process.env.SystemRoot}\\System32` };
const init = cp.spawnSync(bin('mariadb-install-db'), [`--datadir=${data}`, `--socket=${pipe}`, '--skip-networking'], { env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
if (init.status !== 0) throw Error(`Inicialización fallida: ${init.stderr}`);
const fd = fs.openSync(path.join(run, 'server.log'), 'wx');
const networkArgs = tlsLab ? ['--bind-address=127.0.0.1', `--port=${port}`, `--ssl-ca=${path.join(run, 'server-cert.pem')}`, `--ssl-cert=${path.join(run, 'server-cert.pem')}`, `--ssl-key=${path.join(run, 'server-key.pem')}`] : ['--skip-networking'];
const server = cp.spawn(bin('mariadbd'), ['--no-defaults', `--basedir=${engine}`, `--datadir=${data}`, ...networkArgs, ...(hostingerLab ? ['--sql-mode=NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', '--innodb-strict-mode=0'] : []), '--enable-named-pipe', `--socket=${pipe}`, '--innodb-buffer-pool-size=64M', '--console'], { env, stdio: ['ignore', fd, fd], windowsHide: true });
fs.closeSync(fd);
const args = ['--no-defaults', '--protocol=PIPE', '--host=.', `--socket=${pipe}`, '-uroot', '--batch', '--skip-column-names'];
const sql = input => cp.spawnSync(bin('mariadb'), args, { env, input, encoding: 'utf8', windowsHide: true, timeout: 5000 });
let verified = false;
try {
  let ready;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error('Servidor detenido');
    ready = sql('SELECT VERSION(),@@skip_networking,@@socket,@@datadir,@@port;');
    if (ready.status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (ready?.status !== 0) throw Error('Servidor no disponible');
  const [version, networkDisabled, socket, dir, actualPort] = ready.stdout.trim().split('\t');
  if (!version.startsWith('11.8.9-MariaDB') || networkDisabled !== (tlsLab ? '0' : '1') || (tlsLab && Number(actualPort) !== port) || socket !== pipe || path.resolve(dir).toLowerCase() !== data.toLowerCase()) throw Error('Identidad incorrecta');
  verified = true;
  const permissions = ['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER'];
  const omissions = permissions.map((permission, i) => `CREATE USER 'fifo_missing_${i}'@'localhost' IDENTIFIED BY 'fifo-test-only'; GRANT ${permissions.filter(p => p !== permission).join(',')} ON canecas_cli_test.* TO 'fifo_missing_${i}'@'localhost';`).join(' ');
  if (sql(`CREATE DATABASE canecas_salida_test; CREATE DATABASE canecas_redistribucion_test; CREATE DATABASE canecas_redis_gen_test; CREATE DATABASE canecas_redis_inst_test; CREATE DATABASE canecas_cat_gen_test; CREATE DATABASE canecas_ven_gen_test; CREATE DATABASE canecas_instalacion_test; CREATE DATABASE canecas_fifo_test; CREATE DATABASE canecas_test; CREATE DATABASE canecas_api_test; CREATE DATABASE canecas_schema_test; CREATE DATABASE canecas_recovery_test; CREATE DATABASE canecas_cli_test; CREATE DATABASE canecas_tls_test; CREATE DATABASE canecas_hostinger_test; CREATE DATABASE canecas_warning_test; CREATE USER 'fifo_host'@'localhost' IDENTIFIED BY 'fifo-host-only' REQUIRE SSL; GRANT ${permissions.join(',')} ON canecas_hostinger_test.* TO 'fifo_host'@'localhost'; CREATE USER 'fifo_lab'@'localhost' IDENTIFIED BY 'fifo-lab-only'; GRANT ${permissions.join(',')} ON canecas_cli_test.* TO 'fifo_lab'@'localhost'; CREATE USER 'fifo_tls'@'localhost' IDENTIFIED BY 'fifo-tls-only' REQUIRE SSL; GRANT ${permissions.join(',')} ON canecas_tls_test.* TO 'fifo_tls'@'localhost'; CREATE USER 'fifo_denied'@'localhost' IDENTIFIED BY 'fifo-denied-only' REQUIRE SSL; GRANT SELECT ON canecas_tls_test.* TO 'fifo_denied'@'localhost'; ${omissions}`).status !== 0) throw Error('No se crearon bases desechables');
  const files = hostingerLab ? ['src/lib/canecas/hostinger-modo.db.test.ts', 'src/lib/canecas/instalacion-controlada.db.test.ts', 'src/lib/canecas/salidas-fifo.db.test.ts', 'src/lib/canecas/redistribucion.db.test.ts', 'src/lib/canecas/instalacion-redistribucion.db.test.ts', 'src/lib/canecas/catalogos.db.test.ts', 'src/lib/canecas/instalacion-catalogos.db.test.ts', 'src/lib/canecas/ventas.db.test.ts', 'src/lib/canecas/instalacion-ventas.db.test.ts', 'src/lib/canecas/instalacion-simplificacion.db.test.ts', 'src/lib/canecas/simplificacion.db.test.ts', 'src/lib/canecas/numeracion-historica.db.test.ts', 'src/lib/canecas/phpmyadmin-bloque.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'redistribucion' ? ['src/lib/canecas/generar-contrato-redistribucion.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'catalogos' ? ['src/lib/canecas/generar-contrato-catalogos.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'ventas' ? ['src/lib/canecas/generar-contrato-ventas.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === 'simplificacion' ? ['src/lib/canecas/generar-contrato-simplificacion.db.test.ts'] : process.env.CANECAS_GENERAR_CONTRATO === '1' ? ['src/lib/canecas/generar-contrato.db.test.ts'] : ['src/lib/canecas/permisos-reales.db.test.ts', 'src/lib/canecas/interrupciones.db.test.ts', 'src/lib/canecas/tls-costos.db.test.ts', 'src/lib/canecas/cli-costos.db.test.ts', 'src/lib/canecas/recuperacion.db.test.ts', 'src/lib/canecas/costos-fifo.db.test.ts', 'src/lib/canecas/confirmar.db.test.ts', 'src/lib/canecas/flujo.db.test.ts', 'src/lib/canecas/schema.db.test.ts', 'src/lib/canecas/redistribucion.db.test.ts', 'src/lib/canecas/instalacion-redistribucion.db.test.ts', 'src/lib/canecas/catalogos.db.test.ts', 'src/lib/canecas/instalacion-catalogos.db.test.ts', 'src/lib/canecas/ventas.db.test.ts', 'src/lib/canecas/instalacion-ventas.db.test.ts', 'src/lib/canecas/instalacion-simplificacion.db.test.ts', 'src/lib/canecas/simplificacion.db.test.ts', 'src/lib/canecas/numeracion-historica.db.test.ts'];
  const test = cp.spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.mts', ...files, '--maxWorkers=1'], { cwd: repo, env: { ...env, CANECAS_FIFO_TEST_PIPE: pipe, CANECAS_TEST_PIPE: pipe, ...(process.env.CANECAS_GENERAR_CONTRATO ? { CANECAS_GENERAR_CONTRATO: process.env.CANECAS_GENERAR_CONTRATO } : {}), ...(tlsLab ? { CANECAS_TLS_TEST_PORT: String(port), CANECAS_TLS_TEST_CA: path.join(run, 'server-cert.pem'), CANECAS_TLS_TEST_WRONG_CA: path.join(run, 'wrong-cert.pem') } : {}) }, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  console.log(test.stdout, test.stderr);
  process.exitCode = test.status === 0 ? 0 : 1;
} finally {
  const stop = verified ? sql('SHUTDOWN;') : null;
  if (stop?.status !== 0 && server.exitCode === null) server.kill();
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (server.exitCode === null) process.exitCode = 1;
  console.log('Laboratorio:', run);
}
