// TEST DOUBLE ONLY. No persistence, process sharing, DB locks or crash durability.
import type { Scope } from '../contracts';
import { UniqueOrderCollision, type Audit, type Event, type OrderRepository, type StoredOrder, type Transaction, type Committed } from '../ports';
export class ModelRepository implements OrderRepository {
  orders = new Map<string, StoredOrder>(); events: Event[] = []; audits: Audit[] = []; outbox: Event[] = [];
  failAt: 'insert' | 'save' | 'event' | 'audit' | 'outbox' | 'commit' | 'afterCommit' | null = null;
  calls = 0;
  private tail: Promise<void> = Promise.resolve();
  key(scope: Scope, externalId: string) { return JSON.stringify([scope.environment, scope.tenantId, scope.clientId, scope.integrationId, externalId]); }
  async runAtomic<T>(scope: Scope, action: (tx: Transaction) => Promise<T>): Promise<Committed<T>> {
    this.calls++; const previous = this.tail; let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    const saved = structuredClone({ orders: this.orders, events: this.events, audits: this.audits, outbox: this.outbox });
    const fault = (point: typeof this.failAt) => { if (this.failAt === point) { this.failAt = null; throw new Error('simulated SQL_SECRET_MUST_NOT_LEAK'); } };
    let committed = false;
    try {
      const result = await action({
        insert: async order => { fault('insert'); const key = this.key(scope, order.input.externalOrderId); if (this.orders.has(key)) throw new UniqueOrderCollision(); this.orders.set(key, structuredClone(order)); },
        findForUpdate: async id => structuredClone(this.orders.get(this.key(scope, id)) ?? null),
        save: async (order, version) => { fault('save'); const key = this.key(scope, order.input.externalOrderId); if (this.orders.get(key)?.version !== version) throw new Error('version conflict'); this.orders.set(key, structuredClone(order)); },
        appendEvent: async event => { fault('event'); if (this.events.some(x => x.orderId === event.orderId && x.version === event.version)) throw new Error('event duplicate'); this.events.push(structuredClone(event)); },
        appendAudit: async audit => { fault('audit'); this.audits.push(structuredClone(audit)); },
        enqueue: async event => { fault('outbox'); this.outbox.push(structuredClone(event)); },
      } satisfies Transaction);
      fault('commit'); committed = true; fault('afterCommit');
      return { value: structuredClone(result), durability: 'SIMULATED' };
    } catch (error) {
      if (!committed) { this.orders = saved.orders; this.events = saved.events; this.audits = saved.audits; this.outbox = saved.outbox; }
      throw error;
    } finally { release(); }
  }
}
