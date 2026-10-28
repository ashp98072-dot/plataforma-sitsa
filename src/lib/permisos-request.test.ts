import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import * as shared from "./permisos-shared";
import * as catalogo from "./permisos-catalogo";
const hasBase = (() => { try { execFileSync("git", ["cat-file", "-e", "b432bd80dc52d29c9b5584c73718099c276f24a2^{commit}"], { stdio: "ignore" }); return true; } catch { return false; } })();

// Simula únicamente el dispatcher de memoización POR RENDER de React.
// Sin dispatcher (Route Handler) no memoiza; cada request nuevo usa otro scope.
const m = vi.hoisted(() => ({ query: vi.fn(), scope: null as Map<unknown, Map<string, unknown>> | null }));
vi.mock("./db", () => ({ query: m.query, getPool: () => { throw new Error("Sin BD real"); } }));
function cacheForRender<T extends (...args: never[]) => unknown>(fn: T): T {
  return ((...args: never[]) => {
    if (!m.scope) return fn(...args);
    let entries = m.scope.get(fn);
    if (!entries) m.scope.set(fn, entries = new Map());
    const key = JSON.stringify(args);
    if (!entries.has(key)) entries.set(key, fn(...args));
    return entries.get(key);
  }) as T;
}
vi.mock("react", () => ({ cache: cacheForRender }));
import { permisosEfectivos } from "./permisos";

function base() {
  const source = execFileSync("git", ["show", "b432bd80dc52d29c9b5584c73718099c276f24a2:src/lib/permisos.ts"], { encoding: "utf8" });
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { permisosEfectivos?: typeof permisosEfectivos } = {};
  const modules: Record<string, unknown> = { "./db": { query: m.query }, "@/lib/db": { query: m.query }, "@/lib/permisos-shared": shared, "@/lib/permisos-catalogo": catalogo };
  runInNewContext(code, { exports, require: (id: string) => { if (!(id in modules)) throw new Error(id); return modules[id]; } });
  return exports.permisosEfectivos!;
}

beforeEach(() => {
  m.scope = new Map();
  m.query.mockReset().mockImplementation(async (_sql: string, args: number[]) => [{ modulo: "programacion", puede_ver: args[0] === 7, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }]);
});

it.skipIf(!hasBase)("BASE: layout y Dashboard Operaciones consultan dos veces la misma matriz", async () => {
  const read = base();
  const [a, b] = await Promise.all([read(7, "Operaciones"), read(7, "Operaciones")]);
  expect(a).toEqual(b);
  expect(m.query).toHaveBeenCalledTimes(2);
  console.info("BASE PERMISOS", { consultas: m.query.mock.calls.length });
});

it("HEAD: mismo render y usuario/rol comparten UNA lectura y conservan el resultado BASE", async () => {
  const [a, b] = await Promise.all([permisosEfectivos(7, "Operaciones"), permisosEfectivos(7, "Operaciones")]);
  expect(a).toEqual(b);
  expect(m.query).toHaveBeenCalledTimes(1);
  if (hasBase) expect(a).toEqual(await base()(7, "Operaciones"));
});

it("usuarios distintos y roles distintos no comparten entradas", async () => {
  const [a, b] = await Promise.all([permisosEfectivos(7, "Operaciones"), permisosEfectivos(8, "Operaciones")]);
  expect(a.find(p => p.modulo === "programacion")?.puedeVer).toBe(true);
  expect(b.find(p => p.modulo === "programacion")?.puedeVer).toBe(false);
  await permisosEfectivos(7, "RRHH");
  expect(m.query).toHaveBeenCalledTimes(3);
});

it("un request nuevo observa revocación inmediatamente; sin caché compartida", async () => {
  expect((await permisosEfectivos(7, "Operaciones")).find(p => p.modulo === "programacion")?.puedeVer).toBe(true);
  m.query.mockResolvedValue([{ modulo: "programacion", puede_ver: 0, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }]);
  m.scope = new Map();
  expect((await permisosEfectivos(7, "Operaciones")).find(p => p.modulo === "programacion")?.puedeVer).toBe(false);
  expect(m.query).toHaveBeenCalledTimes(2);
});

it("Route Handlers releen permisos; Admin conserva privilegios anteriores pero consulta grants explícitos C3C2", async () => {
  m.scope = null;
  await permisosEfectivos(7, "Operaciones"); await permisosEfectivos(7, "Operaciones");
  expect(m.query).toHaveBeenCalledTimes(2);
  await permisosEfectivos(7, "Admin");
  expect(m.query).toHaveBeenCalledTimes(3);
});
