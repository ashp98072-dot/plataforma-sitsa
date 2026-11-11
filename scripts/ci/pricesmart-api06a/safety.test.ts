// Pruebas ESTÁTICAS de las guardas del laboratorio API-06A. No inician MariaDB, no abren sockets, no tocan bases. Solo crean/borran directorios temporales propios.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adminOptions, assertAdminOptions, assertLabGate, assertServerArgs, buildChildEnv, buildServerArgs, createManifest, IDENTITY_QUERY, IDENTITY_QUERIES,
  isAllowedConnect, isolationJson, onlyLoopbackListeners, parsePidFile, pickPort, processMatches, publicManifest, safeRemoveRunDir, SqlGate, validateManifest, validateServerIdentity,
} from "./safety.mjs";
import { FORBIDDEN_PORTS, LAB_ACK_ENV, LAB_ACK_PHRASE, PORT_MAX, PORT_MIN, REQUIRED_BRANCH } from "./constants.mjs";
import { validateSandboxConfig } from "../../sandbox-config.mjs";

const tempRoot = fs.realpathSync.native(os.tmpdir());
const seeded = (seed: string) => { let i = 0; return (n: number) => crypto.createHash("sha256").update(`${seed}:${i++}`).digest().subarray(0, n); };
const mk = (seed = "a") => { const m = createManifest({ randomBytes: seeded(seed), tempRoot }); m.port = 50123; return m; };
const home = "C:\\Users\\Admin\\Documents\\plataforma-sitsa-limpio\\.lab-runtime\\mariadb-11.8.9-winx64";
const baseEnv = { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: "C:\\x" };
const gateArgs = { argv: ["--run-isolated"], env: { [LAB_ACK_ENV]: LAB_ACK_PHRASE }, platform: "win32", branch: REQUIRED_BRANCH, envFilesInCwd: [] as string[] };

describe("compuerta contra ejecución accidental", () => {
  it("acepta solo las dos formas exactas y exige confirmación para ejecutar", () => {
    expect(assertLabGate(gateArgs)).toBe("--run-isolated");
    expect(assertLabGate({ ...gateArgs, argv: ["--preflight-only"], env: {} })).toBe("--preflight-only");
  });
  it.each([[[]], [["--run"]], [["--run-isolated", "--x"]], [["--preflight-only", "--run-isolated"]]])("rechaza argumentos %j", (argv) => {
    expect(() => assertLabGate({ ...gateArgs, argv: argv as string[] })).toThrow();
  });
  it("rechaza plataforma, rama, archivos .env y falta de confirmación", () => {
    expect(() => assertLabGate({ ...gateArgs, platform: "linux" })).toThrow(/Windows/);
    expect(() => assertLabGate({ ...gateArgs, branch: "main" })).toThrow(/Rama/);
    expect(() => assertLabGate({ ...gateArgs, branch: "feature/pricesmart-api07-lab-outbox" })).not.toThrow();   // rama apilada B10 (lista cerrada)
    expect(() => assertLabGate({ ...gateArgs, branch: "feature/pricesmart-api09-adaptacion-durable" })).not.toThrow();   // rama de API-09 (B11)
    expect(() => assertLabGate({ ...gateArgs, branch: "feature/pricesmart-api07-lab-outbox-x" })).toThrow(/Rama/);   // sin patrones
    expect(() => assertLabGate({ ...gateArgs, envFilesInCwd: [".env.local"] })).toThrow(/\.env/);
    expect(() => assertLabGate({ ...gateArgs, env: {} })).toThrow(/confirmación/);
    expect(() => assertLabGate({ ...gateArgs, env: { [LAB_ACK_ENV]: "si" } })).toThrow(/confirmación/);
  });
  it.each(["DB_HOST", "DB_PASSWORD", "DATABASE_URL", "MYSQL_HOST", "MARIADB_ROOT_PASSWORD", "HOSTINGER_TOKEN", "SANDBOX_ID", "NOVALVION_ENV", "AUTH_SECRET", "HTTPS_PROXY", "FEL_CREDENTIALS_KEY", "PGPASSWORD"])
  ("se niega a ejecutar si el entorno padre define %s (posible base real)", (name) => {
    expect(() => assertLabGate({ ...gateArgs, env: { ...gateArgs.env, [name]: "x" } })).toThrow(/entorno/);
    expect(() => assertLabGate({ ...gateArgs, argv: ["--preflight-only"], env: { [name]: "x" } })).toThrow(/entorno/);
  });
});

describe("puerto, manifiesto y rutas", () => {
  it("el rango dinámico excluye por construcción 3306/33060/5432 y demás servicios", () => {
    for (const p of FORBIDDEN_PORTS) expect(p < PORT_MIN || p > PORT_MAX).toBe(true);
    expect(PORT_MIN).toBeGreaterThanOrEqual(49152);
  });
  it("pickPort siempre cae en el rango, reintenta si está ocupado y falla si todo está ocupado", () => {
    let n = 0; const rnd = () => (n += 7919);
    for (let i = 0; i < 500; i++) { const p = pickPort(rnd, () => false); expect(p).toBeGreaterThanOrEqual(PORT_MIN); expect(p).toBeLessThanOrEqual(PORT_MAX); expect(FORBIDDEN_PORTS).not.toContain(p); }
    let busyOnce = true; expect(pickPort(rnd, () => { const b = busyOnce; busyOnce = false; return b; })).toBeGreaterThan(0);
    expect(() => pickPort(rnd, () => true)).toThrow(/puerto libre/);
  });
  it("el manifiesto tiene identificadores válidos para el adaptador y para validateSandboxConfig", () => {
    const m = mk();
    expect(m.schema).toMatch(/^sandbox_api02_[a-z0-9_]+$/); expect(m.user).toBe(m.schema); expect(m.sandboxId).toMatch(/^[a-z0-9][a-z0-9-]{2,47}$/);
    expect(m.schema.length).toBeLessThanOrEqual(64); expect(m.runDir).toBe(path.join(tempRoot, `novalvion-ps-api06a-${m.id}`));
    for (const s of Object.values(m.secrets) as string[]) expect(s).toMatch(new RegExp(`^sandbox:${m.sandboxId}:[a-f0-9]{64}$`));
    expect(new Set(Object.values(m.secrets)).size).toBe(5);
    expect(validateManifest(m, tempRoot, { requirePort: true })).toBe(m);
  });
  it("publicManifest no contiene secretos", () => {
    const m = mk(); const text = JSON.stringify(publicManifest(m));
    for (const s of Object.values(m.secrets) as string[]) expect(text).not.toContain(s);
    expect(text).not.toContain("secrets");
  });
  it.each([
    ["runDir fuera de la raíz temporal", (m: ReturnType<typeof mk>) => { m.runDir = "C:\\Windows\\Temp\\x"; }],
    ["datadir en otra carpeta", (m: ReturnType<typeof mk>) => { m.datadir = "C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Data"; }],
    ["pidFile ajeno", (m: ReturnType<typeof mk>) => { m.pidFile = "C:\\x\\server.pid"; }],
    ["pipe distinto", (m: ReturnType<typeof mk>) => { m.pipe = "MySQL"; }],
    ["esquema distinto", (m: ReturnType<typeof mk>) => { m.schema = "sandbox_api02_otro"; }],
    ["usuario distinto del esquema", (m: ReturnType<typeof mk>) => { m.user = "root"; }],
    ["puerto 3306", (m: ReturnType<typeof mk>) => { m.port = 3306; }],
    ["puerto 33060", (m: ReturnType<typeof mk>) => { m.port = 33060; }],
    ["puerto 5432", (m: ReturnType<typeof mk>) => { m.port = 5432; }],
    ["puerto privilegiado", (m: ReturnType<typeof mk>) => { m.port = 80; }],
    ["id no hexadecimal", (m: ReturnType<typeof mk>) => { m.id = "zz"; }],
  ])("validateManifest rechaza: %s", (_n, tamper) => {
    const m = mk(); tamper(m); expect(() => validateManifest(m, tempRoot, { requirePort: true })).toThrow();
  });
});

describe("argumentos del servidor y entorno del proceso de pruebas", () => {
  it("los argumentos exactos limitan a loopback y desactivan nombres/archivos locales", () => {
    const m = mk(); const a = buildServerArgs(m, home);
    expect(a).toContain("--bind-address=127.0.0.1"); expect(a).toContain(`--port=${m.port}`); expect(a).toContain("--skip-name-resolve"); expect(a).toContain("--local-infile=0");
    expect(a).toContain("--no-defaults"); expect(a.some((x) => /skip-grant-tables|--skip-networking|0\.0\.0\.0|--init-file|log-bin|--defaults/.test(x))).toBe(false);
    expect(a.find((x) => x.startsWith("--datadir="))).toBe(`--datadir=${m.datadir}`);
    expect(assertServerArgs(a, m, home)).toBe(a);
  });
  it.each(["--skip-grant-tables", "--bind-address=0.0.0.0", "--init-file=C:\\x.sql", "--log-bin", "--defaults-file=C:\\my.ini", "--skip-networking", "--general-log=1", "--plugin-load=x", "--event-scheduler=ON"])
  ("assertServerArgs rechaza el argumento añadido %s", (extra) => {
    const m = mk(); expect(() => assertServerArgs([...buildServerArgs(m, home), extra], m, home)).toThrow();
  });
  it("assertServerArgs rechaza cambios de valor, orden o ausencia", () => {
    const m = mk(); const a = buildServerArgs(m, home);
    expect(() => assertServerArgs(a.map((x) => x.replace("127.0.0.1", "0.0.0.0")), m, home)).toThrow();
    expect(() => assertServerArgs(a.map((x) => x.replace(`--port=${m.port}`, "--port=3306")), m, home)).toThrow();
    expect(() => assertServerArgs([...a].reverse(), m, home)).toThrow();
    expect(() => assertServerArgs(a.filter((x) => x !== "--local-infile=0"), m, home)).toThrow();
  });
  it("el entorno hijo se construye desde cero: no hereda variables de la consola", () => {
    const m = mk(); const env = buildChildEnv(m, { ...baseEnv, DB_HOST: "prod.example", DB_PASSWORD: "real", HTTPS_PROXY: "http://p", AUTH_SECRET: "real", HOSTINGER_TOKEN: "t", MYSQL_PWD: "x" });
    expect(Object.keys(env).sort()).toEqual(["AUTH_SECRET", "CB2_PUBLIC_ORIGIN", "DB_HOST", "DB_NAME", "DB_PASSWORD", "DB_PORT", "DB_USER", "EMPRESA_DOMINIOS", "NEXT_TELEMETRY_DISABLED", "NODE_ENV",
      "NOVALVION_ENV", "PATH", "PORTAL_CREDENTIALS_KEY", "PS06A_APP_PASSWORD", "PS06A_WORKER_PASSWORD", "SANDBOX_ID", "SANDBOX_ROOT", "SystemRoot", "TEMP", "TMP", "UPLOAD_DIR", "WINDIR"].sort());
    expect(env.DB_HOST).toBe("127.0.0.1"); expect(env.DB_PORT).toBe(String(m.port)); expect(env.DB_PASSWORD).toBe(m.secrets.DB_PASSWORD); expect(env.DB_PASSWORD).not.toBe("real");
    expect(Object.values(env).join("|")).not.toMatch(/prod\.example|hostinger|HTTPS_PROXY|http:\/\/p/i);
    expect(() => buildChildEnv(m, baseEnv, { MYSQL_PWD: "x" })).toThrow(/no permitida/);
  });
  it("el entorno y el manifiesto producidos PASAN el validateSandboxConfig real; la desviación del destino NO", () => {
    const m = createManifest({ randomBytes: seeded("v"), tempRoot }); m.port = 50999;
    fs.mkdirSync(m.runDir); try {
      for (const d of [m.sandboxRoot, m.uploadsDir]) fs.mkdirSync(d);
      fs.writeFileSync(path.join(m.sandboxRoot, "isolation.json"), JSON.stringify(isolationJson(m)));
      const cwd = fs.mkdtempSync(path.join(tempRoot, "ps06a-cwd-")); try {
        const env = buildChildEnv(m, baseEnv);
        expect(validateSandboxConfig(env as never, cwd)).toMatchObject({ id: m.sandboxId });
        for (const bad of [{ DB_HOST: "localhost" }, { DB_HOST: "203.0.113.5" }, { DB_PORT: "3306" }, { DB_NAME: "sandbox_otra" }, { DB_USER: "root" }, { DB_PASSWORD: "x" }]) {
          expect(() => validateSandboxConfig({ ...env, ...bad } as never, cwd)).toThrow();
        }
        fs.writeFileSync(path.join(cwd, ".env.local"), "X=1");
        expect(() => validateSandboxConfig(env as never, cwd)).toThrow();
      } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
    } finally { fs.rmSync(m.runDir, { recursive: true, force: true }); }
  });
});

describe("conexiones permitidas: demostración de que MySQL80, PostgreSQL y Hostinger son inalcanzables", () => {
  const m = mk();
  it("solo el pipe del run y 127.0.0.1:<puerto del run>", () => {
    expect(isAllowedConnect({ host: "127.0.0.1", port: m.port }, m)).toBe(true);
    expect(isAllowedConnect({ path: `\\\\.\\pipe\\${m.pipe}` }, m)).toBe(true);
  });
  it.each([
    [{ host: "127.0.0.1", port: 3306 }], [{ host: "localhost", port: 3306 }], [{ host: "::1", port: 3306 }], [{ host: "127.0.0.1", port: 33060 }], [{ host: "127.0.0.1", port: 5432 }],
    [{ host: "127.0.0.1", port: 50122 }], [{ host: "127.0.0.1", port: 50124 }], [{ host: "localhost", port: 50123 }], [{ host: "0.0.0.0", port: 50123 }], [{ host: "::1", port: 50123 }],
    [{ host: "srv-hostinger.example", port: 3306 }], [{ host: "mysql.hostinger.com", port: 50123 }], [{ host: "203.0.113.9", port: 50123 }],
    [{ path: "\\\\.\\pipe\\MySQL" }], [{ path: "\\\\.\\pipe\\ps06a-otro" }], [{ path: "C:\\Windows\\mysql.sock" }],
  ])("rechaza %j", (target) => { expect(isAllowedConnect(target as never, m)).toBe(false); });
  it("las opciones administrativas solo admiten el pipe (nada de TCP, hosts ni overrides)", () => {
    expect(() => assertAdminOptions(adminOptions(m), m)).not.toThrow();
    expect(() => assertAdminOptions({ ...adminOptions(m), host: "127.0.0.1" }, m)).toThrow();
    expect(() => assertAdminOptions({ ...adminOptions(m), port: 3306 }, m)).toThrow();
    expect(() => assertAdminOptions({ ...adminOptions(m), socketPath: "\\\\.\\pipe\\MySQL" }, m)).toThrow();
    expect(() => assertAdminOptions({ ...adminOptions(m), password: "x" }, m)).toThrow();
    expect(() => assertAdminOptions({ ...adminOptions(m), multipleStatements: true }, m)).toThrow();
  });
});

describe("compuerta SQL: ninguna operación antes de confirmar la identidad", () => {
  const approved = ["CREATE DATABASE `x`", "USE `x`", "SHUTDOWN"];
  it("antes de confirmar solo pasan consultas de identidad", () => {
    const g = new SqlGate(IDENTITY_QUERIES, approved);
    expect(g.check(IDENTITY_QUERY)).toBe("identity");
    for (const sql of ["CREATE DATABASE `x`", "DROP DATABASE x", "SHUTDOWN", "SELECT 1", "USE `x`"]) expect(() => g.check(sql)).toThrow(/antes de confirmar/);
  });
  it("tras confirmar solo pasan sentencias exactas aprobadas", () => {
    const g = new SqlGate(IDENTITY_QUERIES, approved); g.confirm();
    expect(g.check("CREATE DATABASE `x`")).toBe("approved");
    for (const sql of ["create database `x`", "CREATE DATABASE `x` ", "CREATE DATABASE `y`", "DROP DATABASE `x`", "TRUNCATE t", "DELETE FROM t", "ALTER TABLE t", "GRANT ALL ON *.* TO a", ""]) expect(() => g.check(sql)).toThrow();
    expect(() => g.confirm()).toThrow(/ya confirmada/);
  });
  it("run() ejecuta solo lo aprobado y redacta CREATE USER en el registro", async () => {
    const calls: string[] = []; const conn = { query: async (sql: string) => { calls.push(sql); return [[], []]; } };
    const g = new SqlGate(IDENTITY_QUERIES, ["CREATE USER `u`@`h` IDENTIFIED BY 'secreto'"]);
    await expect(g.run(conn, "CREATE USER `u`@`h` IDENTIFIED BY 'secreto'")).rejects.toThrow();
    await g.run(conn, IDENTITY_QUERY); g.confirm(); await g.run(conn, "CREATE USER `u`@`h` IDENTIFIED BY 'secreto'");
    expect(calls).toEqual([IDENTITY_QUERY, "CREATE USER `u`@`h` IDENTIFIED BY 'secreto'"]);
    expect(JSON.stringify(g.executed)).not.toContain("secreto");
    await expect(g.run(conn, "DROP DATABASE x")).rejects.toThrow(); expect(calls).toHaveLength(2);
  });
});

describe("identidad del servidor y del proceso", () => {
  const m = mk(); m.pid = 4242;
  const good = { datadir: `${m.datadir}\\`, pidFile: m.pidFile, port: m.port, bindAddress: "127.0.0.1", version: "11.8.9-MariaDB", socket: m.pipe, basedir: `${home}\\`, skipNameResolve: 1, localInfile: 0, fk: 1, checks: 1, securePriv: m.filesDir, lockWait: 3, readOnly: 0, logBin: 0 };
  it("acepta la identidad esperada", () => { expect(() => validateServerIdentity(good, m, home)).not.toThrow(); });
  it.each([
    ["datadir de MySQL80", { datadir: "C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Data\\" }], ["puerto 3306", { port: 3306 }], ["bind 0.0.0.0", { bindAddress: "0.0.0.0" }],
    ["MySQL 8.0", { version: "8.0.46" }], ["MariaDB de otra versión", { version: "11.4.2-MariaDB" }], ["pipe ajeno", { socket: "MySQL" }], ["basedir ajeno", { basedir: "C:\\Program Files\\MySQL\\MySQL Server 8.0\\" }],
    ["local_infile activo", { localInfile: 1 }], ["resolución de nombres activa", { skipNameResolve: 0 }], ["FK desactivadas", { fk: 0 }], ["solo lectura", { readOnly: 1 }], ["log binario", { logBin: 1 }],
  ])("rechaza %s", (_n, patch) => { expect(() => validateServerIdentity({ ...good, ...patch }, m, home)).toThrow(/no autorizada/); });
  it("rechaza respuesta vacía", () => { expect(() => validateServerIdentity(undefined, m, home)).toThrow(); });
  it("processMatches exige PID, ejecutable del motor, datadir, puerto y pipe", () => {
    const info = { pid: 4242, exe: `${home}\\bin\\mariadbd.exe`.toUpperCase(), cmd: `x --datadir=${m.datadir} --port=${m.port} --socket=${m.pipe}` };
    expect(processMatches(info, m, home)).toBe(true);
    expect(processMatches({ ...info, exe: "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe" }, m, home)).toBe(false);
    expect(processMatches({ ...info, pid: 4243 }, m, home)).toBe(false);
    expect(processMatches({ ...info, cmd: `--datadir=C:\\otro --port=${m.port} --socket=${m.pipe}` }, m, home)).toBe(false);
    expect(processMatches(null, m, home)).toBe(false);
  });
  it("onlyLoopbackListeners y parsePidFile", () => {
    expect(onlyLoopbackListeners([{ pid: 1, address: "127.0.0.1", port: 50123 }], 1, 50123)).toBe(true);
    for (const l of [[{ pid: 1, address: "0.0.0.0", port: 50123 }], [{ pid: 1, address: "::", port: 50123 }], [{ pid: 1, address: "127.0.0.1", port: 3306 }], [], [{ pid: 1, address: "127.0.0.1", port: 50123 }, { pid: 1, address: "0.0.0.0", port: 9 }]])
      expect(onlyLoopbackListeners(l, 1, 50123)).toBe(false);
    expect(parsePidFile("4242\r\n")).toBe(4242); expect(parsePidFile("x")).toBe(0);
  });
});

describe("limpieza segura (directorios temporales propios)", () => {
  const make = (seed: string) => { const m = createManifest({ randomBytes: seeded(seed), tempRoot }); fs.mkdirSync(m.runDir); fs.mkdirSync(m.datadir); fs.writeFileSync(path.join(m.datadir, "f.bin"), "x"); return m; };
  it("borra solo el directorio del run", () => {
    const m = make("c1"); const sentinel = fs.mkdtempSync(path.join(tempRoot, "ps06a-sentinel-")); fs.writeFileSync(path.join(sentinel, "keep"), "1");
    try { safeRemoveRunDir(m, tempRoot, fs); expect(fs.existsSync(m.runDir)).toBe(false); expect(fs.existsSync(path.join(sentinel, "keep"))).toBe(true); } finally { fs.rmSync(sentinel, { recursive: true, force: true }); fs.rmSync(m.runDir, { recursive: true, force: true }); }
  });
  it("rechaza una unión/enlace dentro del run y NO borra nada", () => {
    const m = make("c2"); const outside = fs.mkdtempSync(path.join(tempRoot, "ps06a-outside-")); fs.writeFileSync(path.join(outside, "valioso.txt"), "no borrar");
    try {
      fs.symlinkSync(outside, path.join(m.runDir, "enlace"), "junction");
      expect(() => safeRemoveRunDir(m, tempRoot, fs)).toThrow(/Enlace/);
      expect(fs.existsSync(path.join(outside, "valioso.txt"))).toBe(true); expect(fs.existsSync(path.join(m.datadir, "f.bin"))).toBe(true);
    } finally { try { fs.unlinkSync(path.join(m.runDir, "enlace")); } catch { /* ya retirado */ } fs.rmSync(outside, { recursive: true, force: true }); fs.rmSync(m.runDir, { recursive: true, force: true }); }
  });
  it("rechaza manifiestos manipulados (ruta fuera de la raíz o no hija directa)", () => {
    const m = make("c3");
    try {
      expect(() => safeRemoveRunDir({ ...m, runDir: path.dirname(m.runDir) }, tempRoot, fs)).toThrow();
      expect(() => safeRemoveRunDir({ ...m, runDir: "C:\\Users" }, tempRoot, fs)).toThrow();
      expect(() => safeRemoveRunDir({ ...m, id: "0".repeat(32) }, tempRoot, fs)).toThrow();
      expect(fs.existsSync(m.datadir)).toBe(true);
    } finally { fs.rmSync(m.runDir, { recursive: true, force: true }); }
  });
});

describe("auditoría estática del ejecutor", () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "run-windows.mjs"), "utf8");
  it("importar el ejecutor no inicia nada y expone main()", async () => {
    const mod = await import("./run-windows.mjs"); expect(typeof mod.main).toBe("function");
  });
  it("sin borrados directos, sin shell, sin DROP/TRUNCATE, sin puertos de otros servicios", () => {
    expect(/\b(rmSync|unlinkSync|rmdirSync|unlink\()/.test(source)).toBe(false);
    expect(source.match(/safeRemoveRunDir\(/g)?.length).toBe(1);   // única llamada (la importación no lleva paréntesis)
    expect(source).not.toMatch(/\bexec(Sync)?\(|shell:\s*true|DROP |TRUNCATE|--skip-grant-tables|3306|33060|5432|0\.0\.0\.0|hostinger/i);
  });
  it("una sola conexión administrativa por función, siempre validada, y solo por pipe", () => {
    expect(source.match(/mysql\.createConnection\(/g)?.length).toBe(1);
    expect(source).toMatch(/assertAdminOptions\(o, m\);\s*try \{ return await mysql\.createConnection\(o\)/);
    expect(source).not.toMatch(/createPool|host:/);
  });
  it("el SQL administrativo solo se ejecuta mediante SqlGate", () => {
    expect(source.match(/\.query\(/g)?.length ?? 0).toBe(0);
    expect(source.match(/gate\.run\(/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
