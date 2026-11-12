import { randomBytes } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Scope } from '../contracts';
import type { LinkResult } from './tms-link';

// PRICESMART API-13 — reintentos controlados de la vinculación TMS (solo laboratorio, igual que la vinculación).
// Garantías:
//  · NO depende de que PriceSmart reenvíe la orden: las órdenes recibidas sin vínculo completo se descubren desde ps_api01_orders (barrido) y se encolan solas.
//  · Idempotente: reutiliza `linker.link` (token de reclamo + alta atómica de solicitud y vínculo + GET_LOCK por orden). Reintentar nunca crea una segunda solicitud.
//  · Concurrencia: cada trabajo se reclama con un lease (UPDATE condicionado, hora de la base de datos) y se cierra con fencing (lease_owner + attempts). Dos trabajadores no procesan lo mismo.
//  · Recuperación tras reinicio: el estado vive en MariaDB; un lease vencido de un trabajador caído vuelve a ser elegible.
//  · Límites: máximo de intentos con retroceso exponencial; los fallos que requieren una persona (rechazo del TMS, ambigüedad, orden cancelada) pasan a BLOCKED sin reintentar.
//  · Registro: cada intento queda en ps_api13_link_attempts (append-only) con su resultado; sin tokens, firmas ni cuerpos de solicitud.
//  · Aislamiento multiempresa: cada trabajo conserva su alcance completo; el destino lo decide el mapeo administrativo de ese alcance (el trabajador no recibe empresa del exterior).

export type RetryPolicy = { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; leaseMs: number; batch: number };
export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({ maxAttempts: 6, baseDelayMs: 30_000, maxDelayMs: 600_000, leaseMs: 120_000, batch: 10 });

export type JobStatus = 'PENDING' | 'DONE' | 'BLOCKED' | 'EXHAUSTED';
export type Classified = { status: JobStatus; outcome: string; detail: string | null; delayMs: number };

export const backoffMs = (policy: RetryPolicy, attemptNo: number) => Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attemptNo - 1));

/** Clasificación PURA de un resultado de vinculación. Los textos que se guardan son códigos o mensajes de validación cortos (nunca el error crudo de una excepción). */
export function classify(result: LinkResult | { thrown: unknown }, attemptNo: number, policy: RetryPolicy): Classified {
  if ('thrown' in result) {
    const e = result.thrown as { code?: unknown; errno?: unknown; name?: unknown };
    const code = typeof e?.code === 'string' ? e.code : typeof e?.errno === 'number' ? `errno ${e.errno}` : typeof e?.name === 'string' ? e.name : 'ERROR';
    return transient('ERROR', code.slice(0, 60), attemptNo, policy);
  }
  switch (result.state) {
    case 'LINKED': case 'ALREADY_LINKED': return { status: 'DONE', outcome: result.state, detail: null, delayMs: 0 };
    case 'REJECTED_BY_TMS': return { status: 'BLOCKED', outcome: 'REJECTED_BY_TMS', detail: (result.detail ?? '').slice(0, 200) || null, delayMs: 0 };   // requiere corregir datos: no se reintenta solo
    case 'RECOVERY_AMBIGUOUS': return { status: 'BLOCKED', outcome: 'RECOVERY_AMBIGUOUS', detail: 'más de una solicitud con el mismo reclamo', delayMs: 0 };
    case 'UNMAPPED': return transient('UNMAPPED', 'sin mapeo administrativo para el alcance', attemptNo, policy);   // se puede corregir con configuración: reintenta con límite
    case 'LOCK_TIMEOUT': return transient('LOCK_TIMEOUT', 'otro proceso vinculaba la misma orden', attemptNo, policy);
    case 'ORDER_NOT_FOUND': return transient('ORDER_NOT_FOUND', null, attemptNo, policy);
    default: return transient('ERROR', 'resultado desconocido', attemptNo, policy);
  }
}
function transient(outcome: string, detail: string | null, attemptNo: number, policy: RetryPolicy): Classified {
  return attemptNo >= policy.maxAttempts
    ? { status: 'EXHAUSTED', outcome, detail, delayMs: 0 }
    : { status: 'PENDING', outcome, detail, delayMs: backoffMs(policy, attemptNo) };
}

export type AttemptSummary = { externalOrderId: string; attemptNo: number; outcome: string; status: JobStatus | 'LEASE_LOST' };

export function createLinkRetry(deps: { pool: Pool; schema: string; linker: { link(scope: Scope, externalOrderId: string): Promise<LinkResult> }; policy?: Partial<RetryPolicy> }) {
  const { pool, schema, linker } = deps;
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(schema)) throw new Error('esquema inválido');
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...deps.policy };
  const q = (table: string) => `\`${schema}\`.\`${table}\``;
  const J = q('ps_api13_link_jobs'); const A = q('ps_api13_link_attempts'); const O = q('ps_api01_orders'); const L = q('ps_api12_tms_links'); const M = q('ps_api12_tms_mapping');
  const scopeOf = (r: RowDataPacket): Scope => ({ environment: Buffer.from(r.environment).toString() as 'sandbox', tenantId: Number(r.tenant_id), clientId: Number(r.client_id), integrationId: Buffer.from(r.integration_id).toString() });
  const keyOf = (s: Scope): [Buffer, number, number, Buffer] => [Buffer.from(s.environment), s.tenantId, s.clientId, Buffer.from(s.integrationId)];
  const text = (v: unknown) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v));

  /** Sesión READ COMMITTED (el aislamiento por instantánea de MariaDB 11 haría fallar el reclamo concurrente con el error 1020). El proxy del pool sandbox consume un SET de una sola vez, por eso es de sesión. */
  async function session<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection(); let broken = false;
    try { await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED'); return await fn(conn); }
    finally {
      try { await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ'); } catch { broken = true; }
      if (broken) conn.destroy(); else conn.release();
    }
  }

  const enqueueSql = (extra: string) => `INSERT IGNORE INTO ${J} (environment, tenant_id, client_id, integration_id, order_id, external_order_id, empresa_id, status, attempts, next_attempt_at, created_at, updated_at)
    SELECT o.environment, o.tenant_id, o.client_id, o.integration_id, o.id, o.external_order_id, m.empresa_id, 'PENDING', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
      FROM ${O} o LEFT JOIN ${M} m ON m.environment=o.environment AND m.tenant_id=o.tenant_id AND m.client_id=o.client_id AND m.integration_id=o.integration_id
     WHERE o.state='RECEIVED' ${extra}`;

  /** Encola UNA orden (idempotente). */
  async function enqueue(scope: Scope, externalOrderId: string): Promise<void> {
    await pool.execute(enqueueSql('AND o.environment=? AND o.tenant_id=? AND o.client_id=? AND o.integration_id=? AND o.external_order_id=?'), [...keyOf(scope), Buffer.from(externalOrderId)]);
  }
  /** Barrido: órdenes RECEIVED sin trabajo y sin vínculo completo (p. ej. caída entre el commit de la orden y el encolado). No depende de PriceSmart. */
  async function sweep(limit = 100): Promise<number> {
    const [r] = await pool.execute<ResultSetHeader>(
      enqueueSql(`AND NOT EXISTS (SELECT 1 FROM ${J} j WHERE j.environment=o.environment AND j.tenant_id=o.tenant_id AND j.client_id=o.client_id AND j.integration_id=o.integration_id AND j.order_id=o.id)
        AND NOT EXISTS (SELECT 1 FROM ${L} l WHERE l.environment=o.environment AND l.tenant_id=o.tenant_id AND l.client_id=o.client_id AND l.integration_id=o.integration_id AND l.order_id=o.id AND l.solicitud_id IS NOT NULL)
        ORDER BY o.received_at LIMIT ${Math.max(1, Math.min(1000, Math.trunc(limit)))}`), []);
    return r.affectedRows;
  }

  type Claimed = { scope: Scope; orderId: Buffer; externalOrderId: string; attemptNo: number; lease: Buffer };
  /** Reclama trabajos vencidos con un lease. Hora de la base de datos; el UPDATE condicionado es la única forma de obtener un trabajo. */
  async function claim(limit: number, only?: { scope: Scope; externalOrderId: string }): Promise<Claimed[]> {
    const lease = randomBytes(16);
    const cond = only ? 'AND environment=? AND tenant_id=? AND client_id=? AND integration_id=? AND external_order_id=?' : '';
    const params: unknown[] = [lease, policy.leaseMs * 1000, ...(only ? [...keyOf(only.scope), Buffer.from(only.externalOrderId)] : [])];
    return session(async (conn) => {
      await conn.execute(
        `UPDATE ${J} SET lease_owner=?, lease_until=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND), attempts=attempts+1, updated_at=UTC_TIMESTAMP(6)
          WHERE status='PENDING' AND next_attempt_at<=UTC_TIMESTAMP(6) AND (lease_until IS NULL OR lease_until<UTC_TIMESTAMP(6)) ${cond}
          ORDER BY next_attempt_at LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}`, params as never);
      const [rows] = await conn.execute<RowDataPacket[]>(`SELECT environment, tenant_id, client_id, integration_id, order_id, external_order_id, attempts FROM ${J} WHERE lease_owner=? AND lease_until>UTC_TIMESTAMP(6)`, [lease]);
      return rows.map((r) => ({ scope: scopeOf(r), orderId: r.order_id as Buffer, externalOrderId: text(r.external_order_id), attemptNo: Number(r.attempts), lease }));
    });
  }

  async function process(job: Claimed, workerId: string): Promise<AttemptSummary> {
    const k = [...keyOf(job.scope), job.orderId];
    const [ins] = await pool.execute<ResultSetHeader>(`INSERT INTO ${A} (environment, tenant_id, client_id, integration_id, order_id, attempt_no, worker_id, started_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(6))`, [...k, job.attemptNo, workerId.slice(0, 40)]);
    let verdict: Classified;
    try {
      const [st] = await pool.execute<RowDataPacket[]>(`SELECT o.state, (SELECT COUNT(*) FROM ${L} l WHERE l.environment=o.environment AND l.tenant_id=o.tenant_id AND l.client_id=o.client_id AND l.integration_id=o.integration_id AND l.order_id=o.id AND l.solicitud_id IS NOT NULL) AS linked
        FROM ${O} o WHERE o.environment=? AND o.tenant_id=? AND o.client_id=? AND o.integration_id=? AND o.id=?`, k);
      if (st.length === 1 && text(st[0].state) !== 'RECEIVED' && Number(st[0].linked) === 0) verdict = { status: 'BLOCKED', outcome: 'ORDER_NOT_ELIGIBLE', detail: 'la orden ya no está en estado RECEIVED y no tiene vínculo', delayMs: 0 };   // p. ej. cancelada antes de vincular: no se crea solicitud
      else verdict = classify(await linker.link(job.scope, job.externalOrderId), job.attemptNo, policy);
    } catch (thrown) { verdict = classify({ thrown }, job.attemptNo, policy); }
    // Cierre con fencing: solo quien conserva el lease de ESTE intento puede cerrar el trabajo.
    const [fin] = await pool.execute<ResultSetHeader>(
      `UPDATE ${J} SET status=?, next_attempt_at=DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? MICROSECOND), lease_owner=NULL, lease_until=NULL, last_outcome=?, last_detail=?, updated_at=UTC_TIMESTAMP(6),
              empresa_id=COALESCE(empresa_id, (SELECT m.empresa_id FROM ${M} m WHERE m.environment=${J}.environment AND m.tenant_id=${J}.tenant_id AND m.client_id=${J}.client_id AND m.integration_id=${J}.integration_id))
        WHERE environment=? AND tenant_id=? AND client_id=? AND integration_id=? AND order_id=? AND lease_owner=? AND attempts=?`,
      [verdict.status, verdict.delayMs * 1000, verdict.outcome, verdict.detail, ...k, job.lease, job.attemptNo]);
    const lost = fin.affectedRows !== 1;
    await pool.execute(`UPDATE ${A} SET outcome=?, detail=?, finished_at=UTC_TIMESTAMP(6) WHERE id=?`, [lost ? 'LEASE_LOST' : verdict.outcome, lost ? 'otro trabajador asumió la orden' : verdict.detail, ins.insertId]);
    return { externalOrderId: job.externalOrderId, attemptNo: job.attemptNo, outcome: lost ? 'LEASE_LOST' : verdict.outcome, status: lost ? 'LEASE_LOST' : verdict.status };
  }

  /** Un ciclo de trabajo: barrido + reclamo + proceso secuencial. Seguro de ejecutar desde varios procesos a la vez. */
  async function runOnce(workerId: string, limit = policy.batch): Promise<AttemptSummary[]> {
    await sweep(limit * 5);
    const out: AttemptSummary[] = [];
    for (const job of await claim(limit)) out.push(await process(job, workerId));
    return out;
  }
  /** Intento inmediato de UNA orden (vía rápida tras recibirla): encola y la procesa si nadie más la tiene. Si falla, el trabajo queda para el trabajador. */
  async function attemptNow(scope: Scope, externalOrderId: string, workerId = 'inline'): Promise<AttemptSummary[]> {
    await enqueue(scope, externalOrderId);
    const out: AttemptSummary[] = [];
    for (const job of await claim(1, { scope, externalOrderId })) out.push(await process(job, workerId));
    return out;
  }
  return { enqueue, sweep, claim, runOnce, attemptNow, policy };
}

/** Arranca (una sola vez por proceso) un trabajador periódico. Solo se usa en la composición de laboratorio y SOLO si el entorno lo pide explícitamente. */
export function startLinkWorker(retry: { runOnce(workerId: string): Promise<AttemptSummary[]> }, everyMs: number): void {
  const KEY = Symbol.for('novalvion.pricesmart.linkworker');
  const store = globalThis as unknown as Record<symbol, ReturnType<typeof setInterval> | undefined>;
  if (store[KEY] || !Number.isSafeInteger(everyMs) || everyMs < 1000) return;
  const workerId = `w${randomBytes(6).toString('hex')}`; let running = false;
  const timer = setInterval(() => { if (running) return; running = true; retry.runOnce(workerId).catch(() => undefined).finally(() => { running = false; }); }, everyMs);
  timer.unref();
  store[KEY] = timer;
}
