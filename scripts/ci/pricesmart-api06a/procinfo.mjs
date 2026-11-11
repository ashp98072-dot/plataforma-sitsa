// PRICESMART-API-06A (AUD-01/AUD-02) — consultas de procesos/puertos de solo lectura con estado EXPLÍCITO y terminación verificada.
// Principio: toda consulta devuelve 'absent' | 'present' | 'unknown' (o 'free' | 'busy' | 'unknown'). Un fallo, una salida incompleta o ilegible es SIEMPRE 'unknown',
// nunca "ausente". Quien decide borrar o terminar algo debe exigir un estado demostrado. `runPs` es inyectable para poder probar los fallos sin PowerShell real.
import cp from 'node:child_process';

export function defaultRunPs(script, timeout = 20000) {
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout });
  return { status: r.status, signal: r.signal, error: r.error, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
// Cualquier excepción de PowerShell/CIM termina con código 3 y mensaje en stderr; nunca se confunde con "no hay resultados".
const wrap = (body) => `$ErrorActionPreference='Stop'; try { ${body} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 3 }`;

function parseRun(r) {
  if (!r) return { ok: false, reason: 'sin resultado de la consulta' };
  if (r.error) return { ok: false, reason: `error al lanzar PowerShell: ${r.error.code ?? r.error.message}` };
  if (r.signal) return { ok: false, reason: `consulta interrumpida por ${r.signal}` };
  if (r.status !== 0) return { ok: false, reason: `consulta fallida (código ${r.status})` };
  try { return { ok: true, value: JSON.parse(String(r.stdout).trim()) }; } catch { return { ok: false, reason: 'salida de la consulta no es JSON' }; }
}
const asArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const validPid = (pid) => Number.isInteger(pid) && pid > 0 && pid < 2 ** 31;

/** Proceso por PID: absent (consulta correcta y no existe) / present (con ejecutable y línea de comandos completos) / unknown. */
export function classifyProcess(r, pid) {
  const p = parseRun(r); if (!p.ok) return { state: 'unknown', reason: p.reason };
  const v = p.value;
  if (v && v.found === false) return { state: 'absent' };
  if (v && v.found === true && Number(v.pid) === pid && typeof v.exe === 'string' && v.exe && typeof v.cmd === 'string' && v.cmd) return { state: 'present', info: { pid, exe: v.exe, cmd: v.cmd } };
  return { state: 'unknown', reason: 'registro de proceso incompleto o inesperado (¿acceso denegado?)' };
}
export function inspectProcess(pid, runPs = defaultRunPs) {
  if (!validPid(pid)) return { state: 'unknown', reason: 'PID inválido' };
  const body = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($null -eq $p) { '{"found":false}' } else { [pscustomobject]@{found=$true;pid=[int]$p.ProcessId;exe=$p.ExecutablePath;cmd=$p.CommandLine} | ConvertTo-Json -Compress }`;
  return classifyProcess(runPs(wrap(body)), pid);
}

/** Sockets en escucha de un PID. La lista global debe ser no vacía (una lista vacía indica una consulta rota, no "sin sockets"). */
export function classifyListeners(r) {
  const p = parseRun(r); if (!p.ok) return { state: 'unknown', reason: p.reason };
  const v = p.value;
  if (!v || v.ok !== true || !Number.isInteger(v.total) || v.total <= 0) return { state: 'unknown', reason: 'lista global de sockets vacía o inválida' };
  const list = asArray(v.listeners);
  if (list.some((l) => typeof l.address !== 'string' || !Number.isInteger(l.port))) return { state: 'unknown', reason: 'socket incompleto' };
  return { state: 'known', listeners: list.map((l) => ({ address: l.address, port: l.port })) };
}
export function listenersOfPid(pid, runPs = defaultRunPs) {
  if (!validPid(pid)) return { state: 'unknown', reason: 'PID inválido' };
  const body = `$all = @(Get-NetTCPConnection -State Listen); $mine = @($all | Where-Object { $_.OwningProcess -eq ${pid} } | ForEach-Object { [pscustomobject]@{address=[string]$_.LocalAddress;port=[int]$_.LocalPort} }); [pscustomobject]@{ok=$true;total=$all.Count;listeners=$mine} | ConvertTo-Json -Compress -Depth 4`;
  const r = classifyListeners(runPs(wrap(body)));
  return r.state === 'known' ? { state: 'known', listeners: r.listeners.map((l) => ({ pid, ...l })) } : r;
}

/** Recuento verificado (la lista global debe ser no vacía): known{count} / unknown. */
export function classifyCount(r) {
  const p = parseRun(r); if (!p.ok) return { state: 'unknown', reason: p.reason };
  const v = p.value;
  if (!v || v.ok !== true || !Number.isInteger(v.total) || v.total <= 0 || !Number.isInteger(v.count) || v.count < 0) return { state: 'unknown', reason: 'consulta incompleta' };
  return { state: 'known', count: v.count };
}
/** Puerto: free / busy / unknown. */
export function classifyPort(r) {
  const c = classifyCount(r);
  return c.state === 'known' ? { state: c.count === 0 ? 'free' : 'busy' } : c;
}
export function inspectPort(port, runPs = defaultRunPs) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { state: 'unknown', reason: 'puerto inválido' };
  const body = `$all = @(Get-NetTCPConnection); [pscustomobject]@{ok=$true;total=$all.Count;count=@($all | Where-Object { $_.LocalPort -eq ${port} }).Count} | ConvertTo-Json -Compress`;
  return classifyPort(runPs(wrap(body)));
}

/** Descendientes (vivos) de un PID raíz. none / present / unknown. */
export function classifyDescendants(r) {
  const p = parseRun(r); if (!p.ok) return { state: 'unknown', reason: p.reason };
  const v = p.value;
  if (!v || v.ok !== true || !Number.isInteger(v.total) || v.total < 5) return { state: 'unknown', reason: 'lista global de procesos incompleta' };
  const procs = asArray(v.procs);
  if (procs.some((x) => !Number.isInteger(x.pid))) return { state: 'unknown', reason: 'proceso descendiente incompleto' };
  return procs.length === 0 ? { state: 'none' } : { state: 'present', procs: procs.map((x) => ({ pid: x.pid, exe: x.exe ?? '', cmd: x.cmd ?? '' })) };
}
export function descendantsOf(rootPid, runPs = defaultRunPs) {
  if (!validPid(rootPid)) return { state: 'unknown', reason: 'PID inválido' };
  const body = `$all = @(Get-CimInstance Win32_Process); $ids = @{}; $ids[${rootPid}] = $true; $out = @(); $grew = $true; while ($grew) { $grew = $false; foreach ($q in $all) { if ([int]$q.ProcessId -eq $PID) { continue }; if ($ids.ContainsKey([int]$q.ParentProcessId) -and -not $ids.ContainsKey([int]$q.ProcessId)) { $ids[[int]$q.ProcessId] = $true; $out += [pscustomobject]@{pid=[int]$q.ProcessId;exe=$q.ExecutablePath;cmd=$q.CommandLine}; $grew = $true } } }; [pscustomobject]@{ok=$true;total=$all.Count;procs=$out} | ConvertTo-Json -Compress -Depth 4`;
  return classifyDescendants(runPs(wrap(body)));
}
/** Cuenta de procesos por nombre (preflight). */
export function countProcessesNamed(name, runPs = defaultRunPs) {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return { state: 'unknown', reason: 'nombre inválido' };
  const body = `$all = @(Get-Process); [pscustomobject]@{ok=$true;total=$all.Count;count=@($all | Where-Object { $_.ProcessName -eq '${name}' }).Count} | ConvertTo-Json -Compress`;
  return classifyCount(runPs(wrap(body)));
}

/** Terminación VERIFICADA: solo se termina un proceso cuya identidad se demuestra y que pertenece al laboratorio. Nunca por nombre. */
export async function terminateVerified(child, belongs, label, deps = {}) {
  const inspect = deps.inspect ?? inspectProcess; const wait = deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const exited = () => (child.exitCode !== null && child.exitCode !== undefined) || Boolean(child.signalCode);
  if (exited()) return { done: true, how: 'ya había terminado' };
  const s = inspect(child.pid);
  if (s.state === 'absent') return { done: true, how: 'ausente según el sistema' };
  if (s.state !== 'present') return { done: false, reason: `${label}: estado del proceso no verificable (${s.reason ?? s.state}); NO se termina` };
  if (!belongs(s.info)) return { done: false, reason: `${label}: el proceso ${child.pid} no pertenece al laboratorio; NO se termina` };
  child.kill();
  for (let i = 0; i < 40 && !exited(); i++) await wait(250);
  if (!exited()) { child.kill('SIGKILL'); for (let i = 0; i < 20 && !exited(); i++) await wait(250); }
  return exited() ? { done: true, how: 'terminado tras verificar identidad' } : { done: false, reason: `${label}: el proceso no terminó` };
}

/** Terminación VERIFICADA de un proceso sin manejador (descendiente huérfano): se re-inspecciona, debe pertenecer al laboratorio y solo entonces se termina por PID. */
export async function terminateStray(proc, belongs, deps = {}) {
  const inspect = deps.inspect ?? inspectProcess; const kill = deps.kill ?? ((pid) => process.kill(pid)); const wait = deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const s = inspect(proc.pid);
  if (s.state === 'absent') return { done: true };
  if (s.state !== 'present') return { done: false, reason: `proceso ${proc.pid}: estado no verificable (${s.reason ?? s.state}); NO se termina` };
  if (!belongs(s.info)) return { done: false, reason: `proceso ${proc.pid}: no pertenece al laboratorio; NO se termina` };
  kill(proc.pid);
  for (let i = 0; i < 20; i++) {
    await wait(250);
    const t = inspect(proc.pid);
    if (t.state === 'absent') return { done: true };
    if (t.state === 'unknown') return { done: false, reason: `proceso ${proc.pid}: no se pudo comprobar su terminación` };
  }
  return { done: false, reason: `proceso ${proc.pid}: no terminó` };
}
