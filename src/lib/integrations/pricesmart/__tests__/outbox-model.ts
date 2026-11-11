// TEST DOUBLE ONLY (SIMULATED). Reproduce la semántica documentada de ps_api01_outbox: lease con vencimiento, fencing por `attempts`, REVIEW durable.
// No prueba locks InnoDB, SKIP LOCKED, concurrencia entre procesos ni durabilidad.
import type { OutboxClaim, OutboxEvent, OutboxStore } from '../outbox';

type Row = { event: OutboxEvent; status: 'PENDING' | 'LEASED' | 'REVIEW' | 'DONE'; attempts: number; nextAttemptAtMs: number; leaseUntilMs: number | null };
export class OutboxModelStore implements OutboxStore {
  rows: Row[] = [];
  failNext: 'claim' | 'complete' | 'retry' | 'review' | null = null;
  constructor(public nowMs: () => number) {}
  private key(e: OutboxEvent) { return JSON.stringify([e.scope.environment, e.scope.tenantId, e.scope.clientId, e.scope.integrationId, e.orderId, e.version]); }
  enqueue(event: OutboxEvent, dueAtMs = this.nowMs()) { this.rows.push({ event: structuredClone(event), status: 'PENDING', attempts: 0, nextAttemptAtMs: dueAtMs, leaseUntilMs: null }); }
  private fault(op: NonNullable<OutboxModelStore['failNext']>) { if (this.failNext === op) { this.failNext = null; throw new Error('simulated SQL_SECRET_MUST_NOT_LEAK'); } }
  async claim(limit: number, leaseMs: number): Promise<OutboxClaim[]> {
    this.fault('claim'); const now = this.nowMs();
    const due = this.rows.filter(r => (r.status === 'PENDING' && r.nextAttemptAtMs <= now) || (r.status === 'LEASED' && r.leaseUntilMs !== null && r.leaseUntilMs <= now))
      .sort((a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs).slice(0, limit);
    return due.map(r => { r.status = 'LEASED'; r.attempts++; r.leaseUntilMs = now + leaseMs; return { event: structuredClone(r.event), attempt: r.attempts }; });
  }
  private holder(c: OutboxClaim) { return this.rows.find(r => this.key(r.event) === this.key(c.event) && r.status === 'LEASED' && r.attempts === c.attempt); }
  async complete(c: OutboxClaim) { this.fault('complete'); const r = this.holder(c); if (!r) return false; r.status = 'DONE'; r.leaseUntilMs = null; return true; }
  async retry(c: OutboxClaim, delayMs: number) { this.fault('retry'); const r = this.holder(c); if (!r) return false; r.status = 'PENDING'; r.leaseUntilMs = null; r.nextAttemptAtMs = this.nowMs() + delayMs; return true; }
  async review(c: OutboxClaim) { this.fault('review'); const r = this.holder(c); if (!r) return false; r.status = 'REVIEW'; r.leaseUntilMs = null; return true; }
  statusOf(e: OutboxEvent) { return this.rows.find(r => this.key(r.event) === this.key(e)); }
}
