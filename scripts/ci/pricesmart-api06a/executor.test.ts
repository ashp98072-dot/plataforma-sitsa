// Pruebas ESTÁTICAS de las correcciones AUD-01 (limpieza fail-closed), AUD-02 (control de errores del ejecutor) y AUD-03 (resumen). No inician MariaDB.
// Las únicas consultas reales son de SOLO LECTURA sobre el propio proceso de prueba (PowerShell/CIM), para comprobar la tubería.
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  classifyCount, classifyDescendants, classifyListeners, classifyPort, classifyProcess, countProcessesNamed, descendantsOf, forceCrashVerified, inspectPort, inspectProcess, listenersOfPid,
  terminateStray, terminateVerified,
} from "./procinfo.mjs";
import { canProceed, cleanupDecision, labChildBelongs } from "./safety.mjs";
import { BLOCKS, DECLARED_LIMITATIONS, DECLARED_SKIPS, evaluateVitestRun, renderMarkdown, REQUIRED_CASES, summarize } from "./report.mjs";

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

// ---- datos de prueba comunes de AUD-02/04: reproducen lo que realmente emite Vitest para mariadb-real.lab.ts (los casos de OTRA fase aparecen como skipped)
const ALL_IDS = [...new Set([...Object.values(REQUIRED_CASES).flat(), ...Object.values(DECLARED_SKIPS).flat()])];
const mkCase = (id: string, status = "passed") => ({ title: `${id} caso de prueba`, ancestorTitles: ["suite"], status, failureMessages: status === "failed" ? ["boom"] : [] });
type Over = { status?: Record<string, string>; drop?: string[]; add?: unknown[]; dup?: string[] };
function phaseReport(phase: keyof typeof REQUIRED_CASES, over: Over = {}) {
  const mine = REQUIRED_CASES[phase] as readonly string[];
  const tests = ALL_IDS.filter((id) => !(over.drop ?? []).includes(id)).map((id) => mkCase(id, over.status?.[id] ?? (mine.includes(id) ? "passed" : "skipped")));
  for (const id of over.dup ?? []) tests.push(mkCase(id));
  tests.push(...((over.add ?? []) as ReturnType<typeof mkCase>[]));
  return { success: true, numTotalTests: tests.length, numFailedTests: tests.filter((t) => t.status === "failed").length, numFailedTestSuites: 0, testResults: [{ name: "f", status: "passed", assertionResults: tests }] };
}
const okRun = { status: 0, signal: null, error: undefined };
const PHASES = ["main", "crash-prepare", "crash-verify"] as const;

describe("AUD-02/AUD-04 evaluación estricta de cada ejecución de Vitest", () => {
  it.each(PHASES)("PASS en %s con un informe realista (los casos de otra fase aparecen omitidos y no cuentan)", (phase) => {
    expect(evaluateVitestRun(phase, okRun, phaseReport(phase))).toEqual({ state: "PASS", reasons: [] });
  });
  it("el listado de casos obligatorios coincide EXACTAMENTE con los títulos de mariadb-real.lab.ts (sin casos nuevos ni perdidos)", () => {
    const lab = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "mariadb-real.lab.ts"), "utf8");
    const declared = [...lab.matchAll(/\bit(?:\.skip)?\(\s*"(B[0-9]\.[0-9a-z]+)\b/g)].map((m) => m[1]).sort();
    expect(declared).toEqual([...ALL_IDS].sort());
    const skipped = [...lab.matchAll(/\bit\.skip\(\s*"(B[0-9]\.[0-9a-z]+)\b/g)].map((m) => m[1]);
    expect(skipped).toEqual(["B7.5"]);   // la única omisión permanente del archivo es la declarada
  });
  it.each([
    ["error de proceso (p. ej. timeout ETIMEDOUT)", { ...okRun, status: null, error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) }, phaseReport("main")],
    ["terminado por señal", { ...okRun, status: null, signal: "SIGTERM" }, phaseReport("main")],
    ["sin código de salida", { ...okRun, status: null }, phaseReport("main")],
    ["JSON ausente", okRun, null],
    ["JSON ilegible (no objeto)", okRun, "texto"],
    ["cero casos", okRun, { success: true, numTotalTests: 0, testResults: [] }],
    ["recuento inconsistente", okRun, { ...phaseReport("main"), numTotalTests: 999 }],
  ])("INCOMPLETO ante: %s", (_n, r, report) => {
    const e = evaluateVitestRun("main", r as never, report as never); expect(e.state).toBe("INCOMPLETO"); expect(e.reasons.length).toBeGreaterThan(0);
  });
  // AUD-04: presentes pero OMITIDOS
  it.each(["B1.1", "B1.4", "B4.2", "B4.4", "B8.1", "B8.2", "B0.t3", "B3.2", "B6.3"])("INCOMPLETO si el caso obligatorio %s está presente pero en SKIP", (id) => {
    const e = evaluateVitestRun("main", okRun, phaseReport("main", { status: { [id]: "skipped" } }));
    expect(e.state).toBe("INCOMPLETO"); expect(e.reasons.join()).toContain(`OMITIDO (skip): ${id}`);
  });
  it.each([["B1", ["B1.1", "B1.2", "B1.3", "B1.4"]], ["B4", ["B4.1", "B4.2", "B4.3", "B4.4"]], ["B8", ["B8.1", "B8.2"]]])("INCOMPLETO si TODO el bloque %s aparece en el JSON pero con todos sus casos en SKIP", (_b, ids) => {
    const e = evaluateVitestRun("main", okRun, phaseReport("main", { status: Object.fromEntries((ids as string[]).map((i) => [i, "pending"])) }));
    expect(e.state).toBe("INCOMPLETO"); expect(e.reasons).toHaveLength((ids as string[]).length);
  });
  it("INCOMPLETO si un caso obligatorio falta, está duplicado, o aparece un skip no clasificado", () => {
    expect(evaluateVitestRun("main", okRun, phaseReport("main", { drop: ["B5.2"] })).reasons.join()).toContain("ausente: B5.2");
    expect(evaluateVitestRun("main", okRun, phaseReport("main", { dup: ["B2.1"] })).reasons.join()).toContain("duplicado: B2.1");
    expect(evaluateVitestRun("main", okRun, phaseReport("main", { add: [mkCase("B9.9", "skipped")] })).reasons.join()).toContain("no clasificado");
    expect(evaluateVitestRun("main", okRun, phaseReport("main", { add: [{ title: "caso sin id", ancestorTitles: [], status: "skipped", failureMessages: [] }] })).reasons.join()).toContain("no clasificado");
    expect(evaluateVitestRun("main", okRun, phaseReport("main", { add: [mkCase("B1.5", "todo")] })).state).toBe("INCOMPLETO");   // id nuevo omitido sin clasificar
  });
  it("las omisiones que pertenecen a OTRA fase son aceptables; las de ESTA fase no", () => {
    expect(evaluateVitestRun("main", okRun, phaseReport("main")).state).toBe("PASS");   // en 'main' los B7.* están omitidos (otra fase)
    expect(evaluateVitestRun("crash-verify", okRun, phaseReport("crash-verify", { status: { "B7.2": "skipped" } })).state).toBe("INCOMPLETO");
    expect(evaluateVitestRun("crash-prepare", okRun, phaseReport("crash-prepare")).state).toBe("PASS");   // B7.2 omitido allí es de otra fase
    expect(evaluateVitestRun("crash-prepare", okRun, phaseReport("crash-prepare", { status: { "B7.1": "skipped" } })).state).toBe("INCOMPLETO");
  });
  it("B7.5 es una omisión DECLARADA solo en crash-verify: allí no impide el PASS de la fase", () => {
    expect(REQUIRED_CASES["crash-verify"]).not.toContain("B7.5");
    expect(evaluateVitestRun("crash-verify", okRun, phaseReport("crash-verify")).state).toBe("PASS");
    expect(evaluateVitestRun("crash-verify", okRun, phaseReport("crash-verify", { drop: ["B7.5"] })).state).toBe("PASS");   // su ausencia se refleja en el resumen (limitación no observada)
  });
  it.each([
    ["un caso fallido", okRun, phaseReport("main", { status: { "B1.1": "failed" } })],
    ["código de salida ≠ 0", { ...okRun, status: 1 }, phaseReport("main")],
    ["success=false", okRun, { ...phaseReport("main"), success: false }],
    ["suite que no cargó", okRun, { ...phaseReport("main"), testResults: [...phaseReport("main").testResults, { name: "g", status: "failed", assertionResults: [] }] }],
    ["numFailedSuites > 0", okRun, { ...phaseReport("main"), numFailedTestSuites: 1 }],
  ])("FAIL ante: %s", (_n, r, report) => { expect(evaluateVitestRun("main", r as never, report as never).state).toBe("FAIL"); });
  it("fase desconocida o sin ejecución = INCOMPLETO", () => {
    expect(evaluateVitestRun("otra", okRun, phaseReport("main")).state).toBe("INCOMPLETO"); expect(evaluateVitestRun("main", undefined as never, phaseReport("main")).state).toBe("INCOMPLETO");
  });
});

describe("AUD-03/AUD-04 resumen: PASS / PASS CON LIMITACIONES / FAIL / INCOMPLETO", () => {
  const reportsOf = (over: Partial<Record<(typeof PHASES)[number], Over>> = {}) => PHASES.map((phase) => ({ phase, report: phaseReport(phase, over[phase] ?? {}) }));
  const phasesOf = (reports: ReturnType<typeof reportsOf>) => reports.map((r) => ({ name: r.phase, ...evaluateVitestRun(r.phase, okRun, r.report) }));
  const checks = [{ id: "B9.1", name: "apagado", status: "PASS" }, { id: "B7.6", name: "caída forzada", status: "PASS" }];
  const ctxFor = (reports: ReturnType<typeof reportsOf>, extra: Record<string, unknown> = {}) => ({ phases: phasesOf(reports), halted: null, shutdown: { proven: true, reasons: [] }, error: null, ...extra });
  it("sin resultados: INCOMPLETO y todos los bloques NO EJECUTADA", () => {
    const s = summarize([], [], ctxFor([])); expect(s.overall).toBe("INCOMPLETO"); expect(BLOCKS.every((b) => s.blocks[b].status === "NO EJECUTADA")).toBe(true);
  });
  it("ejecución completa y sana: PASS CON LIMITACIONES (único SKIP = B7.5); las omisiones de otra fase NO se cuentan", () => {
    const r = reportsOf(); const s = summarize(r, checks, ctxFor(r));
    expect(s.overall).toBe("PASS CON LIMITACIONES"); expect(s.counts.SKIP).toBe(1); expect(s.otherPhaseOmitted).toBeGreaterThan(20);
    expect(s.rows.filter((x) => x.status === "SKIP").map((x) => x.id)).toEqual(["B7.5"]);
    expect(s.limitations[0]).toMatchObject({ id: "B7.5", declared: "SKIP", observed: "SKIP", violation: false });
    expect(BLOCKS.every((b) => ["PASS", "PASS CON LIMITACIONES"].includes(s.blocks[b].status))).toBe(true);
  });
  it("AUD-04: B1, B4 o B8 presentes pero en SKIP NO dan PASS CON LIMITACIONES: INCOMPLETO", () => {
    for (const id of ["B1.1", "B4.3", "B8.1"]) {
      const r = reportsOf({ main: { status: { [id]: "skipped" } } }); const s = summarize(r, checks, ctxFor(r));
      expect(s.overall).toBe("INCOMPLETO"); expect(s.counts.SKIP).toBe(2); expect(s.gaps.join()).toContain("INCOMPLETA");
    }
  });
  it("un bloque entero omitido (todos sus casos en SKIP) tampoco da PASS: INCOMPLETO", () => {
    const r = reportsOf({ main: { status: { "B4.1": "skipped", "B4.2": "skipped", "B4.3": "skipped", "B4.4": "skipped" } } }); const s = summarize(r, checks, ctxFor(r));
    expect(s.overall).toBe("INCOMPLETO"); expect(s.blocks.B4.status).toBe("SKIP");
  });
  it("resultados parciales (faltan fases o bloques): INCOMPLETO, nunca PASS", () => {
    const r = reportsOf().slice(0, 1); expect(summarize(r, checks, ctxFor(r)).overall).toBe("INCOMPLETO");
    const all = reportsOf(); expect(summarize(all, [], ctxFor(all)).overall).toBe("INCOMPLETO");   // falta B9 (ejecutor)
  });
  it("B7.5 no observada (la fase verify no la reportó): INCOMPLETO", () => {
    const r = reportsOf({ "crash-verify": { drop: ["B7.5"] } }); expect(summarize(r, checks, ctxFor(r)).overall).toBe("INCOMPLETO");
  });
  it("cualquier FAIL domina sobre SKIP y bloques ausentes", () => {
    const f = reportsOf({ main: { status: { "B1.1": "failed" } } }); expect(summarize(f, checks, ctxFor(f)).overall).toBe("FAIL");
    const ok = reportsOf(); expect(summarize(ok, [...checks, { id: "B9.1", name: "apagado", status: "FAIL" }], ctxFor(ok)).overall).toBe("FAIL");
    expect(summarize(ok, checks, ctxFor(ok, { phases: [{ name: "main", state: "FAIL", reasons: ["x"] }] })).overall).toBe("FAIL");
  });
  it("ejecución detenida, fase INCOMPLETA, apagado no demostrado, error del ejecutor o falta de registro de apagado: INCOMPLETO", () => {
    const r = reportsOf();
    expect(summarize(r, checks, ctxFor(r, { halted: { phase: "main", reason: "x" } })).overall).toBe("INCOMPLETO");
    expect(summarize(r, checks, ctxFor(r, { phases: [{ name: "crash-prepare", state: "INCOMPLETO", reasons: ["t"] }] })).overall).toBe("INCOMPLETO");
    expect(summarize(r, checks, ctxFor(r, { shutdown: { proven: false, reasons: ["puerto"] } })).overall).toBe("INCOMPLETO");
    expect(summarize(r, checks, ctxFor(r, { shutdown: null })).overall).toBe("INCOMPLETO");
    expect(summarize(r, checks, ctxFor(r, { error: "falló" })).overall).toBe("INCOMPLETO");
  });
  it("si B7.5 deja de ser SKIP (alguien la activó) se exige nueva revisión: FAIL con violación", () => {
    const r = reportsOf({ "crash-verify": { status: { "B7.5": "passed" } } }); const s = summarize(r, checks, ctxFor(r));
    expect(s.limitations[0].violation).toBe(true); expect(s.overall).toBe("FAIL");
  });
  it("casos sin bloque cuentan como problema; el informe Markdown muestra siempre B7.5 como SKIP declarado", () => {
    const r = reportsOf({ main: { add: [{ title: "sin bloque", ancestorTitles: [], status: "passed", failureMessages: [] }] } }); expect(summarize(r, checks, ctxFor(r)).overall).toBe("FAIL");
    const ok = reportsOf(); const md = renderMarkdown(summarize(ok, checks, ctxFor(ok)), "prueba");
    expect(md).toContain("Global: **PASS CON LIMITACIONES**"); expect(md).toContain("## Limitaciones declaradas"); expect(md).toMatch(/B7\.5 .*\| SKIP \| SKIP \|/);
    const empty = renderMarkdown(summarize([], [], null as never)); expect(empty).toContain("NO OBSERVADA"); expect(empty).toContain("**INCOMPLETO**");
    expect(DECLARED_LIMITATIONS.map((l) => l.id)).toEqual(["B7.5"]);
  });
});

describe("AUD-05 caída forzada B7: interrupción distinta del apagado normal, con rechazos verificados", () => {
  const info = { pid: 777, exe: "C:\\x\\mariadbd.exe", cmd: "mariadbd --datadir=C:\\x" };
  const pre = { phase: "crash-prepare", ready: true, gateConfirmed: true };
  const mkChild = (behavior: "dies" | "ignores" | "refuses" = "dies") => {
    const c = { pid: 777, exitCode: null as number | null, signalCode: null as string | null, calls: [] as (string | undefined)[],
      kill(sig?: string) { c.calls.push(sig); if (behavior === "refuses") return false; if (behavior === "dies") c.signalCode = sig ?? "SIGTERM"; return true; } };
    return c;
  };
  const ctx = (over: Record<string, unknown> = {}) => ({ revalidate: vi.fn(async () => ({ ok: true, reasons: [] })), belongs: () => true, label: "servidor", preconditions: pre, ...over });
  const deps = (states: unknown[]) => { let i = 0; return { inspect: (() => states[Math.min(i++, states.length - 1)]) as never, wait: async () => {}, now: () => 1000 }; };
  it("éxito: revalida, usa 'SIGKILL' EXPLÍCITO una sola vez, verifica la ausencia y devuelve evidencia de la naturaleza de la caída", async () => {
    const c = mkChild(); const cx = ctx();
    const r = await forceCrashVerified(c, cx as never, deps([{ state: "present", info }, { state: "absent" }]));
    expect(r).toMatchObject({ done: true, forced: true, signal: "SIGKILL", postState: "absent", pre: info }); expect(r.method).toMatch(/SIGKILL/); expect(r.method).toMatch(/sin cierre ordenado/);
    expect(c.calls).toEqual(["SIGKILL"]); expect(cx.revalidate).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["fase incorrecta", { ...pre, phase: "main" }], ["sin señal de preparación", { ...pre, ready: false }], ["identidad del laboratorio sin confirmar", { ...pre, gateConfirmed: false }], ["sin precondiciones", undefined],
  ])("RECHAZA sin tocar el proceso: %s", async (_n, preconditions) => {
    const c = mkChild(); const r = await forceCrashVerified(c, ctx({ preconditions }) as never, deps([{ state: "present", info }]));
    expect(r).toMatchObject({ done: false, forced: false }); expect(c.calls).toHaveLength(0);
  });
  it("RECHAZA si el proceso ya terminó, no es verificable, está ausente o no pertenece al laboratorio", async () => {
    const dead = mkChild(); dead.exitCode = 0; expect((await forceCrashVerified(dead, ctx() as never, deps([{ state: "present", info }]))).reason).toMatch(/ya había terminado/);
    for (const st of [{ state: "unknown", reason: "CIM" }, { state: "absent" }]) { const c = mkChild(); expect(await forceCrashVerified(c, ctx() as never, deps([st]))).toMatchObject({ done: false, forced: false }); expect(c.calls).toHaveLength(0); }
    const c = mkChild(); const r = await forceCrashVerified(c, ctx({ belongs: () => false }) as never, deps([{ state: "present", info }]));
    expect(r.reason).toMatch(/no pertenece/); expect(c.calls).toHaveLength(0);
  });
  it("RECHAZA si la revalidación (identidad, ejecutable, datadir, puerto, pipe, sockets) falla, lanza una excepción o devuelve algo inválido", async () => {
    for (const revalidate of [async () => ({ ok: false, reasons: ["datadir distinto"] }), async () => { throw new Error("pipe caído"); }, async () => undefined, async () => ({ ok: "yes", reasons: [] })]) {
      const c = mkChild(); const r = await forceCrashVerified(c, ctx({ revalidate }) as never, deps([{ state: "present", info }]));
      expect(r).toMatchObject({ done: false, forced: false }); expect(r.reason).toMatch(/revalidación previa fallida/); expect(c.calls).toHaveLength(0);
    }
  });
  it("si kill() no puede enviar la interrupción, o el proceso no muere, o su terminación no es verificable: done=false (no se da por caída)", async () => {
    expect(await forceCrashVerified(mkChild("refuses"), ctx() as never, deps([{ state: "present", info }]))).toMatchObject({ done: false, forced: false });
    const stubborn = await forceCrashVerified(mkChild("ignores"), ctx() as never, deps([{ state: "present", info }]));
    expect(stubborn.done).toBe(false); expect(stubborn.reason).toMatch(/no terminó/);
    const unverifiable = await forceCrashVerified(mkChild(), ctx() as never, deps([{ state: "present", info }, { state: "unknown", reason: "CIM" }]));
    expect(unverifiable.done).toBe(false); expect(unverifiable.reason).toMatch(/no verificable/);
    const still = await forceCrashVerified(mkChild(), ctx() as never, deps([{ state: "present", info }, { state: "present", info }]));
    expect(still.done).toBe(false);
  });
  it("la caída forzada y la terminación de limpieza son funciones distintas: la limpieza nunca pasa por forceCrashVerified y viceversa", () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "run-windows.mjs"), "utf8");
    expect(src.match(/forceCrashVerified\(/g)?.length).toBe(1); expect(src).toContain("phase: 'crash-prepare'");
    const iForce = src.indexOf("forceCrashVerified("); const iFinally = src.indexOf("} finally {");
    expect(iForce).toBeGreaterThan(0); expect(iFinally).toBeGreaterThan(iForce);
    expect(src.slice(iFinally)).not.toContain("forceCrashVerified"); expect(src.slice(0, iFinally)).not.toMatch(/terminateVerified\(server/);
    expect(src).toContain("crash-evidence.json"); expect(src).toContain("B7.6"); expect(src).toContain("killed.signal === 'SIGKILL'"); expect(src).toContain("pidFileRemained");
    const around = src.slice(Math.max(0, iForce - 1800), iForce);   // la revalidación está inmediatamente antes
    for (const need of ["inspectProcess(m.pid)", "validateServerIdentity(id2", "listenersOfPid(m.pid)", "parsePidFile("]) expect(around).toContain(need);
  });
});

describe.skipIf(process.platform !== "win32")("AUD-05 comportamiento REAL de kill() en Windows (procesos de prueba inofensivos, sin MariaDB)", () => {
  const spawnDummy = () => cp.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", `ps06a-marker-${process.pid}-${Date.now()}`], { stdio: "ignore", windowsHide: true });
  const alive = async (c: cp.ChildProcess) => { await new Promise((r) => setTimeout(r, 600)); return c.exitCode === null && !c.signalCode; };
  it("forceCrashVerified termina de verdad un proceso real con SIGKILL, lo verifica ausente y registra la naturaleza de la caída", async () => {
    const c = spawnDummy(); expect(await alive(c)).toBe(true);
    try {
      const marker = `ps06a-marker-${process.pid}`;
      const r = await forceCrashVerified(c, { revalidate: async () => ({ ok: true, reasons: [] }), belongs: (i: { cmd: string }) => i.cmd.includes(marker), label: "dummy", preconditions: { phase: "crash-prepare", ready: true, gateConfirmed: true } } as never);
      expect(r).toMatchObject({ done: true, forced: true, signal: "SIGKILL", postState: "absent" }); expect(typeof (r as { elapsedMs?: number }).elapsedMs).toBe("number");
      expect(c.signalCode).toBe("SIGKILL");   // en Windows Node no entrega una señal al proceso: lo termina de forma abrupta y deja constancia de la señal pedida
      expect(c.exitCode).toBeNull();
    } finally { if (c.exitCode === null && !c.signalCode) c.kill("SIGKILL"); }
  }, 60000);
  it("no toca un proceso real que no pertenece al laboratorio (belongs=false) ni si falla la revalidación", async () => {
    const c = spawnDummy(); expect(await alive(c)).toBe(true);
    try {
      const base = { label: "dummy", preconditions: { phase: "crash-prepare", ready: true, gateConfirmed: true } };
      expect((await forceCrashVerified(c, { ...base, revalidate: async () => ({ ok: true, reasons: [] }), belongs: () => false } as never)).done).toBe(false);
      expect((await forceCrashVerified(c, { ...base, revalidate: async () => ({ ok: false, reasons: ["x"] }), belongs: () => true } as never)).done).toBe(false);
      expect(c.exitCode === null && !c.signalCode).toBe(true);   // sigue vivo
    } finally { c.kill("SIGKILL"); }
  }, 60000);
  it("kill() sin argumento (terminación de limpieza) también es abrupto en Windows: no existe cierre ordenado por señal, solo el SQL SHUTDOWN", async () => {
    const c = spawnDummy(); expect(await alive(c)).toBe(true);
    const done = new Promise<void>((r) => c.once("exit", () => r())); c.kill(); await done;
    expect(c.signalCode).toBe("SIGTERM"); expect(c.exitCode).toBeNull();
  }, 60000);
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
