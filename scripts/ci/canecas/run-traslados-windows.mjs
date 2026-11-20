// Laboratorio aislado: datos nuevos, pipe aleatorio y sin red ni .env.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--run-isolated") throw Error("Uso: --run-isolated <motor MariaDB 11.8.9>");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(repo);
const home = fs.realpathSync(process.argv[3]);
const bin = name => path.join(home, "bin", `${name}.exe`);
const hash = crypto.createHash("sha256").update(fs.readFileSync(bin("mariadbd"))).digest("hex");
if (hash !== "de2c4350e36bcdff6a18b614a21701a8a827509f44f51274411bb52a2849f9e5") throw Error("Motor no verificado");
const root = path.join(repo, ".lab-runtime");
fs.mkdirSync(root, { recursive: true });
if (fs.lstatSync(root).isSymbolicLink()) throw Error("Raíz enlazada");
const run = path.join(root, `canecas-${crypto.randomUUID()}`);
fs.mkdirSync(run);
const data = path.join(run, "data"), pipe = `canecas-${crypto.randomUUID()}`;
const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: run, TMP: run, PATH: `${path.join(home, "bin")};${process.env.SystemRoot}\\System32` };
const init = cp.spawnSync(bin("mariadb-install-db"), [`--datadir=${data}`, `--socket=${pipe}`, "--skip-networking"], { env, encoding: "utf8", windowsHide: true, timeout: 60000 });
if (init.status !== 0) throw Error(`Inicialización fallida: ${init.stderr}`);
const fd = fs.openSync(path.join(run, "server.log"), "wx");
const server = cp.spawn(bin("mariadbd"), ["--no-defaults", `--basedir=${home}`, `--datadir=${data}`, "--skip-networking", "--enable-named-pipe", `--socket=${pipe}`, "--innodb-buffer-pool-size=64M", "--console"], { env, stdio: ["ignore", fd, fd], windowsHide: true });
fs.closeSync(fd);
const args = ["--no-defaults", "--protocol=PIPE", "--host=.", `--socket=${pipe}`, "-uroot", "--batch", "--skip-column-names"];
const sql = input => cp.spawnSync(bin("mariadb"), args, { env, input, encoding: "utf8", windowsHide: true, timeout: 5000 });
let verified = false;
try {
  let ready;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error("Servidor detenido");
    ready = sql("SELECT VERSION(),@@skip_networking,@@socket,@@datadir;");
    if (ready.status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (ready?.status !== 0) throw Error("Servidor no disponible");
  const [version, net, socket, dir] = ready.stdout.trim().split("\t");
  if (!version.startsWith("11.8.9-MariaDB") || net !== "1" || socket !== pipe || path.resolve(dir).toLowerCase() !== data.toLowerCase()) throw Error("Identidad incorrecta");
  verified = true;
  if (sql("CREATE DATABASE canecas_traslados_test;").status !== 0) throw Error("No se creó base desechable");
  const vitest = fileURLToPath(import.meta.resolve("vitest/package.json"));
  const test = cp.spawnSync(process.execPath, [path.join(path.dirname(vitest), "vitest.mjs"), "run", "src/lib/canecas/traslados-schema.db.test.ts", "--maxWorkers=1"], { env: { ...env, CANECAS_TEST_PIPE: pipe }, encoding: "utf8", windowsHide: true, timeout: 180000 });
  console.log(test.stdout, test.stderr);
  process.exitCode = test.status === 0 ? 0 : 1;
} finally {
  const stop = verified ? sql("SHUTDOWN;") : null;
  if (stop?.status !== 0 && server.exitCode === null) server.kill();
  await Promise.race([new Promise(resolve => server.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (server.exitCode === null) process.exitCode = 1;
  console.log("Laboratorio:", run);
}


