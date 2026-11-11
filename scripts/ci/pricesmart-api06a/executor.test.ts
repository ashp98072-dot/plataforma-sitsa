// Pruebas ESTÁTICAS de las correcciones AUD-01 (limpieza fail-closed), AUD-02 (control de errores del ejecutor) y AUD-03 (resumen). No inician MariaDB.
// Las únicas consultas reales son de SOLO LECTURA sobre el propio proceso de prueba (PowerShell/CIM), para comprobar la tubería.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  classifyCount, classifyDescendants, classifyListeners, classifyPort, classifyProcess, countProcessesNamed, descendantsOf, inspectPort, inspectProcess, listenersOfPid,
  terminateStray, terminateVerified,
} from "./procinfo.mjs";
import { canProceed, cleanupDecision, labChildBelongs } from "./safety.mjs";
import { BLOCKS, DECLARED_LIMITATIONS, evaluateVitestRun, renderMarkdown, REQUIRED_BLOCKS, summarize } from "./report.mjs";

const ok = (value: unknown) => ({ status: 0, signal: null, error: undefined, stdout: JSON.stringify(value), stderr: "" });
const rawRun = (over: Record<string, unknown>) => ({ status: 0, signal: null, error: undefined, stdout: "", stderr: "", ...over });
const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();

describe("AUD-01 estado explícito de procesos: ausente / presente / desconocido", () => {
  const present = { found: true, pid: 4242, exe: "C:\\x\\mariadbd.exe", cmd: "mariadbd --datadir=C:\\x" };
  it("distingue los tres estados", () => {
    expect(classifyProcess(ok({ found: false }), 4242)).toEqual({ state: "absent" });
    expect(classifyProcess(ok(present), 4242)).toMatchObject({ state: "present", info: { pid: 4242, exe: present.exe, cmd: present.cmd } });
  });
  it.each([
    ["consulta fallida (CIM/WMI caído: código 3)", rawRun({ status: 3, stderr: "Provider load failure" })],
    ["PowerShell no se pudo lanzar", rawRun({ status: null, error: Object.assign(new Error("spawn"), { code: "ENOENT" }) })],
    ["consulta vencida por tiempo (señal)", rawRun({ status: null, signal: "SIGTERM" })],
    ["salida vacía con código 0", rawRun({ stdout: "" })],
    ["salida que no es JSON", rawRun({ stdout: "Access is denied" })],
    ["sin resultado", undefined],
    ["registro sin ejecutable (acceso denegado)", ok({ ...present, exe: null })],
    ["registro sin línea de comandos", ok({ ...present, cmd: "" })],
    ["PID distinto del consultado", ok({ ...present, pid: 1 })],
    ["JSON inesperado", ok({ hola: 1 })],
    ["found ausente", ok({})],
  ])("estado desconocido ante: %s (nunca 'ausente')", (_n, r) => {
    const c = classifyProcess(r as never, 4242); expect(c.state).toBe("unknown"); expect(c).not.toHaveProperty("info");
  });
  it("inspectProcess valida el PID, no ejecuta nada con PID inválido y solo inserta enteros en el script", () => {
    const spy = vi.fn(() => ok({ found: false }));
    for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 31, "12", "1; calc", null, undefined]) expect(inspectProcess(bad as never, spy).state).toBe("unknown");
    expect(spy).not.toHaveBeenCalled();
    inspectProcess(1234, spy); const script = String((spy.mock.calls[0] as unknown[])[0]);
    expect(script).toContain("ProcessId=1234"); expect(script).toContain("exit 3"); expect(script).toContain("$ErrorActionPreference='Stop'");
  });
  it("sockets: lista global vacía o inválida = desconocido, no 'sin sockets'", () => {
    expect(classifyListeners(ok({ ok: true, total: 40, listeners: [] }))).toEqual({ state: "known", listeners: [] });
    expect(classifyListeners(ok({ ok: true, total: 40, listeners: { address: "127.0.0.1", port: 5 } }))).toEqual({ state: "known", listeners: [{ address: "127.0.0.1", port: 5 }] });
    for (const r of [ok({ ok: true, total: 0, listeners: [] }), ok({ ok: false }), rawRun({ status: 3 }), ok({ ok: true, total: 5, listeners: [{ address: "x" }] })]) expect(classifyListeners(r as never).state).toBe("unknown");
    expect(listenersOfPid(7, () => rawRun({ status: 3 }) as never).state).toBe("unknown");
    expect(listenersOfPid(7, () => ok({ ok: true, total: 9, listeners: [{ address: "127.0.0.1", port: 50000 }] }) as never)).toEqual({ state: "known", listeners: [{ pid: 7, address: "127.0.0.1", port: 50000 }] });
  });
  it("puerto: free / busy / unknown; una consulta rota nunca es 'free'", () => {
    expect(classifyPort(ok({ ok: true, total: 30, count: 0 }))).toEqual({ state: "free" });
    expect(classifyPort(ok({ ok: true, total: 30, count: 2 }))).toEqual({ state: "busy" });
    for (const r of [rawRun({ status: 3 }), rawRun({ stdout: "" }), ok({ ok: true, total: 0, count: 0 }), ok({ ok: true, total: 5 }), ok({ ok: true, total: 5, count: -1 })]) expect(classifyPort(r as never).state).toBe("unknown");
    expect(inspectPort(0).state).toBe("unknown"); expect(inspectPort(70000).state).toBe("unknown"); expect(inspectPort(5000, () => rawRun({ status: 3 }) as never).state).toBe("unknown");
    expect(classifyCount(ok({ ok: true, total: 3, count: 1 }))).toEqual({ state: "known", count: 1 });
    expect(countProcessesNamed("x'; calc", () => ok({}) as never).state).toBe("unknown");
  });
  it("descendientes: none / present / unknown", () => {
    expect(classifyDescendants(ok({ ok: true, total: 80, procs: [] }))).toEqual({ state: "none" });
    expect(classifyDescendants(ok({ ok: true, total: 80, procs: { pid: 9, exe: "a", cmd: "b" } }))).toEqual({ state: "present", procs: [{ pid: 9, exe: "a", cmd: "b" }] });
    for (const r of [rawRun({ status: 3 }), ok({ ok: true, total: 2, procs: [] }), ok({ ok: true, total: 80, procs: [{ exe: "a" }] }), rawRun({ stdout: "x" })]) expect(classifyDescendants(r as never).state).toBe("unknown");
    expect(descendantsOf(0).state).toBe("unknown");
  });
});

describe("AUD-01 decisión de limpieza FAIL-CLOSED", () => {
  const good = { exited: true, proc: { state: "absent" }, port: { state: "free" }, strays: { state: "none" }, evidence: true };
  it("solo se borra con TODO demostrado", () => { expect(cleanupDecision(good)).toEqual({ remove: true, reasons: [] }); });
  it.each([
    ["servidor no terminado", { exited: false }],
    ["servidor sin dato de terminación", { exited: undefined }],
    ["proceso aún presente", { proc: { state: "present" } }],
    ["consulta del proceso fallida (unknown)", { proc: { state: "unknown" } }],
    ["sin consulta del proceso", { proc: undefined }],
    ["puerto ocupado", { port: { state: "busy" } }],
    ["consulta del puerto fallida", { port: { state: "unknown" } }],
    ["sin consulta del puerto", { port: undefined }],
    ["descendientes presentes", { strays: { state: "present" } }],
    ["consulta de descendientes fallida", { strays: { state: "unknown" } }],
    ["evidencia no copiada", { evidence: false }],
    ["evidencia sin dato", { evidence: undefined }],
  ])("NO borra ante: %s", (_n, patch) => {
    const d = cleanupDecision({ ...good, ...patch } as never); expect(d.remove).toBe(false); expect(d.reasons.length).toBeGreaterThan(0);
  });
  it("registra todos los motivos acumulados", () => {
    const d = cleanupDecision({ exited: false, proc: { state: "unknown" }, port: { state: "busy" }, strays: { state: "unknown" }, evidence: false });
    expect(d.remove).toBe(false); expect(d.reasons).toHaveLength(5);
  });
});

describe("AUD-01 terminación verificada de procesos propios", () => {
  const fakeChild = (over: Record<string, unknown> = {}) => {
    const c = { pid: 555, exitCode: null as number | null, signalCode: null as string | null, killed: [] as (string | undefined)[], behavior: "exits" as "exits" | "ignores",
      kill(sig?: string) { c.killed.push(sig); if (c.behavior === "exits") c.exitCode = 1; return true; }, ...over };
    return c;
  };
  const deps = (inspect: unknown) => ({ inspect: inspect as never, wait: async () => {} });
  const info = { pid: 555, exe: "C:\\x\\mariadbd.exe", cmd: "x" };
  it("no hace nada si ya terminó", async () => {
    const c = fakeChild({ exitCode: 0 }); const inspect = vi.fn();
    expect(await terminateVerified(c, () => true, "t", deps(inspect))).toMatchObject({ done: true }); expect(inspect).not.toHaveBeenCalled(); expect(c.killed).toHaveLength(0);
  });
  it("si el sistema dice 'ausente' no lo termina y lo da por hecho", async () => {
    const c = fakeChild(); expect(await terminateVerified(c, () => true, "t", deps(() => ({ state: "absent" })))).toMatchObject({ done: true }); expect(c.killed).toHaveLength(0);
  });
  it.each([["consulta fallida", { state: "unknown", reason: "CIM caído" }], ["estado inesperado", { state: "otro" }]])("NO termina ante %s y devuelve done=false", async (_n, st) => {
    const c = fakeChild(); const r = await terminateVerified(c, () => true, "servidor", deps(() => st));
    expect(r.done).toBe(false); expect(r.reason).toMatch(/no verificable/); expect(c.killed).toHaveLength(0);
  });
  it("NO termina un proceso que no pertenece al laboratorio", async () => {
    const c = fakeChild(); const r = await terminateVerified(c, () => false, "servidor", deps(() => ({ state: "present", info })));
    expect(r.done).toBe(false); expect(r.reason).toMatch(/no pertenece/); expect(c.killed).toHaveLength(0);
  });
  it("termina solo tras verificar identidad y pertenencia", async () => {
    const c = fakeChild(); expect(await terminateVerified(c, (i: typeof info) => i.pid === 555, "servidor", deps(() => ({ state: "present", info })))).toMatchObject({ done: true }); expect(c.killed).toEqual([undefined]);
  });
  it("si el proceso ignora la señal, escala a SIGKILL y, si sigue vivo, informa done=false (no se da por apagado)", async () => {
    const c = fakeChild({ behavior: "ignores" }); const r = await terminateVerified(c, () => true, "servidor", deps(() => ({ state: "present", info })));
    expect(r.done).toBe(false); expect(c.killed).toEqual([undefined, "SIGKILL"]);
  });
  it("terminateStray: sin verificación o sin pertenencia no mata; con ambas mata y comprueba la ausencia", async () => {
    const kill = vi.fn(); const wait = async () => {};
    expect((await terminateStray({ pid: 9 }, () => true, { inspect: (() => ({ state: "unknown" })) as never, kill, wait })).done).toBe(false);
    expect((await terminateStray({ pid: 9 }, () => false, { inspect: (() => ({ state: "present", info })) as never, kill, wait })).done).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    let n = 0; const inspect = () => (n++ === 0 ? { state: "present", info } : { state: "absent" });
    expect((await terminateStray({ pid: 9 }, () => true, { inspect: inspect as never, kill, wait })).done).toBe(true); expect(kill).toHaveBeenCalledWith(9);
    n = 0; const flaky = () => (n++ === 0 ? { state: "present", info } : { state: "unknown" });
    expect((await terminateStray({ pid: 9 }, () => true, { inspect: flaky as never, kill, wait })).done).toBe(false);
  });
  it("labChildBelongs exige node actual y ruta de vitest o del run; canProceed exige TODAS las fases en PASS", () => {
    const ctx = { nodeExe: "C:\\node\\node.exe", vitestRoot: "C:\\repo\\node_modules\\vitest", runDir: "C:\\Temp\\novalvion-ps-api06a-x" };
    expect(labChildBelongs({ exe: "C:\\NODE\\node.exe", cmd: "node C:\\repo\\node_modules\\vitest\\vitest.mjs run" }, ctx)).toBe(true);
    expect(labChildBelongs({ exe: "C:\\NODE\\node.exe", cmd: "node C:\\otro\\app.js" }, ctx)).toBe(false);
    expect(labChildBelongs({ exe: "C:\\Windows\\System32\\cmd.exe", cmd: "C:\\repo\\node_modules\\vitest" }, ctx)).toBe(false);
    expect(labChildBelongs({ exe: "C:\\node\\node.exe", cmd: "" }, ctx)).toBe(false); expect(labChildBelongs(null, ctx)).toBe(false);
    expect(canProceed([{ state: "PASS" }])).toBe(true); expect(canProceed([])).toBe(false);
    expect(canProceed([{ state: "PASS" }, { state: "INCOMPLETO" }])).toBe(false); expect(canProceed([{ state: "FAIL" }])).toBe(false);
  });
});

describe("AUD-02 evaluación estricta de cada ejecución de Vitest", () => {
  const t = (title: string, status = "passed") => ({ title, ancestorTitles: [], status, failureMessages: status === "failed" ? ["boom"] : [] });
  const full = (blocks: readonly string[], extra: unknown[] = []) => ({ success: true, numTotalTests: blocks.length + extra.length, numFailedTests: 0, numFailedTestSuites: 0, testResults: [{ name: "f", status: "passed", assertionResults: [...blocks.map((b) => t(`${b}.1 x`)), ...extra] }] });
  const run = { status: 0, signal: null, error: undefined };
  it("PASS solo con ejecución completa y sin fallos", () => { expect(evaluateVitestRun("main", run, full(REQUIRED_BLOCKS.main))).toEqual({ state: "PASS", reasons: [] }); });
  it.each([
    ["error de proceso (p. ej. timeout ETIMEDOUT)", { ...run, status: null, error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) }, full(REQUIRED_BLOCKS.main)],
    ["terminado por señal", { ...run, status: null, signal: "SIGTERM" }, full(REQUIRED_BLOCKS.main)],
    ["sin código de salida", { ...run, status: null }, full(REQUIRED_BLOCKS.main)],
    ["JSON ausente", run, null],
    ["JSON ilegible (no objeto)", run, "texto"],
    ["cero casos", run, { success: true, numTotalTests: 0, testResults: [] }],
    ["falta un bloque requerido (B5)", run, full(REQUIRED_BLOCKS.main.filter((b) => b !== "B5"))],
    ["recuento inconsistente", run, { ...full(REQUIRED_BLOCKS.main), numTotalTests: 99 }],
  ])("INCOMPLETO ante: %s", (_n, r, report) => {
    const e = evaluateVitestRun("main", r as never, report as never); expect(e.state).toBe("INCOMPLETO"); expect(e.reasons.length).toBeGreaterThan(0);
  });
  it.each([
    ["un caso fallido", run, full(REQUIRED_BLOCKS.main, [t("B1.9 malo", "failed")])],
    ["código de salida ≠ 0", { ...run, status: 1 }, full(REQUIRED_BLOCKS.main)],
    ["success=false", run, { ...full(REQUIRED_BLOCKS.main), success: false }],
    ["suite que no cargó", run, { ...full(REQUIRED_BLOCKS.main), testResults: [...full(REQUIRED_BLOCKS.main).testResults, { name: "g", status: "failed", assertionResults: [] }] }],
    ["numFailedTests > 0", run, { ...full(REQUIRED_BLOCKS.main), numFailedTests: 1 }],
  ])("FAIL ante: %s", (_n, r, report) => { expect(evaluateVitestRun("main", r as never, report as never).state).toBe("FAIL"); });
  it("fase desconocida o sin ejecución = INCOMPLETO", () => {
    expect(evaluateVitestRun("otra", run, full(["B1"])).state).toBe("INCOMPLETO"); expect(evaluateVitestRun("main", undefined as never, full(REQUIRED_BLOCKS.main)).state).toBe("INCOMPLETO");
  });
  it("las fases B7 exigen resultados de B7", () => {
    expect(evaluateVitestRun("crash-verify", run, full(["B1"])).state).toBe("INCOMPLETO");
    expect(evaluateVitestRun("crash-verify", run, full(["B7"], [t("B7.5 declarada", "skipped")])).state).toBe("PASS");
  });
});

describe("AUD-03 resumen: PASS / PASS CON LIMITACIONES / FAIL / INCOMPLETO", () => {
  const row = (title: string, status = "passed") => ({ title, ancestorTitles: [], status, failureMessages: status === "failed" ? ["x"] : [] });
  const report = (rows: ReturnType<typeof row>[]) => ({ testResults: [{ assertionResults: rows }] });
  const allBlocks = (skip = false) => BLOCKS.flatMap((b) => [row(`${b}.1 caso`)]).concat(skip ? [row("B7.5 caída durante el COMMIT", "skipped")] : []);
  const healthy = { phases: [{ name: "main", state: "PASS", reasons: [] }], halted: null, shutdown: { proven: true, reasons: [] }, error: null };
  it("sin resultados: INCOMPLETO y todos los bloques NO EJECUTADA", () => {
    const s = summarize([], [], healthy); expect(s.overall).toBe("INCOMPLETO"); expect(BLOCKS.every((b) => s.blocks[b].status === "NO EJECUTADA")).toBe(true);
  });
  it("resultados parciales (faltan bloques): INCOMPLETO, nunca PASS", () => {
    const s = summarize([report([row("B1.1 a"), row("B2.1 b")])], [], healthy); expect(s.overall).toBe("INCOMPLETO"); expect(s.gaps.join()).toMatch(/B0/);
  });
  it("todo PASS pero B7.5 no observada: INCOMPLETO (la limitación declarada debe aparecer)", () => {
    expect(summarize([report(allBlocks(false))], [], healthy).overall).toBe("INCOMPLETO");
  });
  it("todo PASS con B7.5 en SKIP: 'PASS CON LIMITACIONES' (nunca PASS completo)", () => {
    const s = summarize([report(allBlocks(true))], [], healthy);
    expect(s.overall).toBe("PASS CON LIMITACIONES"); expect(s.counts.SKIP).toBe(1); expect(s.limitations[0]).toMatchObject({ id: "B7.5", declared: "SKIP", observed: "SKIP", violation: false }); expect(s.blocks.B7.status).toBe("PASS CON LIMITACIONES");
  });
  it("cualquier FAIL domina sobre SKIP y bloques ausentes", () => {
    expect(summarize([report([row("B1.1 a", "failed"), row("B7.5 c", "skipped")])], [], healthy).overall).toBe("FAIL");
    expect(summarize([report(allBlocks(true))], [{ id: "B9.1", name: "apagado", status: "FAIL" }], healthy).overall).toBe("FAIL");
    expect(summarize([report(allBlocks(true))], [], { ...healthy, phases: [{ name: "main", state: "FAIL", reasons: ["x"] }] }).overall).toBe("FAIL");
  });
  it("ejecución detenida, fase INCOMPLETA, apagado no demostrado o error del ejecutor: INCOMPLETO", () => {
    const base = report(allBlocks(true));
    expect(summarize([base], [], { ...healthy, halted: { phase: "main", reason: "x" } }).overall).toBe("INCOMPLETO");
    expect(summarize([base], [], { ...healthy, phases: [{ name: "crash-prepare", state: "INCOMPLETO", reasons: ["t"] }] }).overall).toBe("INCOMPLETO");
    expect(summarize([base], [], { ...healthy, shutdown: { proven: false, reasons: ["puerto"] } }).overall).toBe("INCOMPLETO");
    expect(summarize([base], [], { ...healthy, shutdown: null }).overall).toBe("INCOMPLETO");
    expect(summarize([base], [], { ...healthy, error: "falló" }).overall).toBe("INCOMPLETO");
  });
  it("si B7.5 deja de ser SKIP (alguien la activó) se exige nueva revisión: FAIL con violación", () => {
    const s = summarize([report(allBlocks(false).concat([row("B7.5 caída durante el COMMIT", "passed")]))], [], healthy);
    expect(s.limitations[0].violation).toBe(true); expect(s.overall).toBe("FAIL");
  });
  it("casos sin bloque cuentan como problema", () => { expect(summarize([report([row("sin bloque")])], [], healthy).overall).toBe("FAIL"); });
  it("el informe Markdown muestra siempre B7.5 como SKIP declarado, los motivos y el estado global", () => {
    const md = renderMarkdown(summarize([report(allBlocks(true))], [], healthy), "prueba");
    expect(md).toContain("Global: **PASS CON LIMITACIONES**"); expect(md).toContain("## Limitaciones declaradas"); expect(md).toMatch(/B7\.5 .*\| SKIP \| SKIP \|/);
    const empty = renderMarkdown(summarize([], [], null as never)); expect(empty).toContain("B7.5"); expect(empty).toContain("NO OBSERVADA"); expect(empty).toContain("**INCOMPLETO**");
    expect(DECLARED_LIMITATIONS.map((l) => l.id)).toEqual(["B7.5"]);
  });
});

describe.skipIf(process.platform !== "win32")("tubería real de consulta (solo lectura sobre el propio proceso de prueba)", () => {
  it("el proceso actual se detecta como presente con su ejecutable; un PID inexistente como ausente", () => {
    const me = inspectProcess(process.pid); expect(me.state).toBe("present");
    expect(me.info).toBeDefined();
    expect(norm(me.info?.exe ?? "")).toBe(norm(process.execPath)); expect((me.info?.cmd ?? "").length).toBeGreaterThan(0);
    expect(inspectProcess(2147483000).state).toBe("absent");
  }, 60000);
  it("puertos, sockets, descendientes y recuentos devuelven estados conocidos (no 'unknown')", () => {
    expect(["free", "busy"]).toContain(inspectPort(1).state);
    expect(listenersOfPid(process.pid).state).toBe("known");
    expect(["none", "present"]).toContain(descendantsOf(process.pid).state);
    expect(countProcessesNamed("mariadbd").state).toBe("known");
  }, 60000);
});

describe("auditoría estática del ejecutor tras las correcciones", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(dir, "run-windows.mjs"), "utf8");
  it("ya no hay consultas ni terminaciones sin verificar", () => {
    expect(source).not.toMatch(/\.kill\(/); expect(source).not.toMatch(/queryProcess|listenersOf\(|portBusy|SilentlyContinue|Number\([^)]*\|\| ?'1'\)/);
    expect(source).not.toMatch(/powershell|Get-CimInstance|Get-NetTCPConnection/i);   // toda consulta del sistema vive en procinfo.mjs
    const procinfo = fs.readFileSync(path.join(dir, "procinfo.mjs"), "utf8");
    expect(procinfo).not.toMatch(/SilentlyContinue/); expect((procinfo.match(/\.kill\(|process\.kill\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("B7 solo se inicia si la fase principal fue PASS completa, y cada paso posterior se vigila", () => {
    const iCan = source.indexOf("if (!halted && !canProceed(phases)) halt('main'");
    const iPrep = source.indexOf("PS06A_CRASH_READY");
    expect(iCan).toBeGreaterThan(0); expect(iPrep).toBeGreaterThan(iCan);
    expect(source).toMatch(/if \(!halted\) \{\s*const ready/);
    for (const needle of ["timeout esperando la señal", "terminó antes de dar la señal", "prepExited()", "terminateVerified(prep", "reapStrays('crash-verify')", "evaluateVitestRun", "canProceed(phases)"]) expect(source).toContain(needle);
  });
  it("la limpieza depende de cleanupDecision y exige evidencia copiada", () => {
    expect(source.match(/cleanupDecision\(/g)?.length).toBe(2); expect(source).toContain("evidence: evidenceKept"); expect(source).toMatch(/if \(decision\.remove\) \{ try \{ safeRemoveRunDir/);
  });
  it("las protecciones anteriores siguen presentes", () => {
    for (const needle of ["assertLabGate(", "verifyEngine(loc)", "assertServerArgs(", "validateServerIdentity(", "gate.confirm()", "assertAdminOptions(", "isolationJson("]) expect(source).toContain(needle);
    expect(source.indexOf("validateServerIdentity(")).toBeLessThan(source.indexOf("gate.confirm()")); expect(source.indexOf("gate.confirm()")).toBeLessThan(source.indexOf("for (const sql of adminStatements"));
  });
});
