import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { aprobarControles, configuracionInicializador, opcionesPipe, prepararMigracion, validarIdentidadServidor, validarManifiesto, validarOpciones, verificarConexion } from "../../../scripts/ci/c3c1/safety.mjs";
import { readFileSync } from "node:fs";

const id = "a".repeat(32);
const runDir = path.resolve(os.tmpdir(), `novalvion-c3c1-${id}`);
const m = { id, database: `c3c1_lab_${id}`, pipe: `c3c1-${id}`, token: "b".repeat(64), runDir, datadir: path.join(runDir, "data"), pidFile: path.join(runDir, "server.pid"), pid: 123 };
const servidor = { datadir: m.datadir, pidFile: m.pidFile, socket: m.pipe, sinRed: 1, version: "11.8.9-MariaDB", fk: 1, checks: 1 };
describe("C3C-1: barreras del laboratorio, sin iniciar procesos ni driver SQL", () => {
  it("inicializador Windows usa solo argumentos admitidos y plantilla propia, sin servicio ni configuración externa", () => {
    const c = configuracionInicializador(m, os.tmpdir());
    expect(c.archivo).toBe(path.join(m.runDir, "init-template.ini"));
    expect(c.args).toEqual([`--datadir=${m.datadir}`, `--socket=${m.pipe}`, "--skip-networking", `--config=${c.archivo}`]);
    expect(c.args.join(" ")).not.toMatch(/--(?:no-defaults|defaults-file|service|port|allow-remote-root-access)(?:[=\s]|$)/);
    expect(c.contenido).toBe("[mysqld]\r\nskip-networking=ON\r\nnamed-pipe=ON\r\n");
    expect(c.contenido).not.toMatch(/!include|!includedir/);
    expect(() => configuracionInicializador({ ...m, database: "novalvion_pruebas" }, os.tmpdir())).toThrow();
    const runner = readFileSync("scripts/ci/c3c1/run-windows.mjs", "utf8");
    expect(runner).toContain("inicializador.args, { cwd: runDir, env, windowsHide: true");
    expect(runner).toContain("fs.writeFileSync(inicializador.archivo, inicializador.contenido, { flag: 'wx' })");
    expect(runner).toContain("if (fs.existsSync(m.datadir)) throw");
    expect(runner).toContain("cp.spawn(path.join(home, 'bin/mariadbd.exe'), ['--no-defaults'");
  });
  it("acepta solo identidad derivada del mismo UUID y datadir temporal nuevo", () => {
    expect(validarManifiesto(m, os.tmpdir())).toBe(m);
    for (const delta of [{ database: "novalvion_pruebas" }, { datadir: path.resolve("data") }, { runDir: path.resolve(".") }, { pipe: "MySQL" }, { pid: 0 }, { id: "x" }]) {
      expect(() => validarManifiesto({ ...m, ...delta }, os.tmpdir())).toThrow();
    }
  });
  it("solo socketPath de pipe; rechaza TCP, puerto, URI, stream y cambio de base", () => {
    const o = opcionesPipe(m); expect(o.socketPath).toBe(`\\\\.\\pipe\\c3c1-${id}`);
    expect(() => validarOpciones(o, m)).not.toThrow();
    for (const delta of [{ host: "127.0.0.1" }, { port: 3306 }, { port: 3407 }, { uri: "mysql://local" }, { stream: {} }, { database: "novalvion_pruebas" }, { socketPath: "\\\\.\\pipe\\MySQL" }]) {
      expect(() => validarOpciones({ ...o, ...delta }, m)).toThrow();
    }
  });
  it("rechaza identidad equivocada, red habilitada y restricciones desactivadas", () => {
    expect(() => validarIdentidadServidor(servidor, m)).not.toThrow();
    for (const delta of [{ datadir: "otro" }, { pidFile: "otro" }, { socket: "MySQL" }, { sinRed: 0 }, { fk: 0 }, { checks: 0 }, { version: "8.0.40" }]) expect(() => validarIdentidadServidor({ ...servidor, ...delta }, m)).toThrow();
  });
  it("comprueba instancia, PID, base y token antes de permitir operaciones", async () => {
    const pid = vi.fn();
    const query = vi.fn().mockResolvedValueOnce([[servidor]]).mockResolvedValueOnce([[{ nombre: m.database }]]).mockResolvedValueOnce([[{ token: m.token }]]);
    await verificarConexion({ query }, m, pid);
    expect(pid).toHaveBeenCalledWith(m);
    const ajena = vi.fn().mockResolvedValueOnce([[servidor]]).mockResolvedValueOnce([[{ nombre: "novalvion_pruebas" }]]);
    await expect(verificarConexion({ query: ajena }, m, pid)).rejects.toThrow("Base no autorizada");
    expect(ajena).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[2][0]).toBe(`SELECT token FROM \`${m.database}\`._c3c1_identity LOCK IN SHARE MODE`);
    const token = vi.fn().mockResolvedValueOnce([[servidor]]).mockResolvedValueOnce([[{ nombre: m.database }]]).mockResolvedValueOnce([[{ token: "otro" }]]);
    await expect(verificarConexion({ query: token }, m, pid)).rejects.toThrow("Identidad de base");
  });
  it("controles con errores, vacíos o forma incorrecta rechazan la ejecución", () => {
    expect(() => aprobarControles([{ control: "FK", errores: 0 }])).not.toThrow();
    for (const r of [[], [{ control: "FK", errores: null }], [{ control: "FK", errores: false }], [{ control: "FK", errores: 1 }], [{ control: "FK", errores: -1 }], [{}], [{ control: "FK", errores: 0 }, {}]]) expect(() => aprobarControles(r)).toThrow();
  });
  it("no prepara DDL para otras bases ni rutinas; runner requiere bandera y no importa entorno de aplicación", () => {
    expect(() => prepararMigracion("DROP DATABASE x", m.database)).toThrow();
    const runner = readFileSync("scripts/ci/c3c1/run-windows.mjs", "utf8");
    for (const texto of ["--run-isolated", "--skip-networking", "--no-defaults", "--enable-named-pipe", "preflight", "prepararMigracion"]) expect(runner).toContain(texto);
    expect(runner).not.toMatch(/dotenv|loadRuntimeEnv|process\.env\.DB_|\.\.\.process\.env/);
    expect(runner.indexOf("await controles(c, sql('preflight'))")).toBeLessThan(runner.indexOf("for (const s of prepararMigracion"));
    expect(runner).toContain("'--config', 'scripts/ci/c3c1/vitest.config.mts'");
    expect(runner).toContain("['--testNamePattern', 'concurrencia C3C-1:']");
    expect(runner).toContain("args.length === 2 && args[1] === '--concurrency-only'");
    expect(readFileSync("scripts/ci/c3c1/vitest.config.mts", "utf8")).toContain("envDir: false");
  });
});
