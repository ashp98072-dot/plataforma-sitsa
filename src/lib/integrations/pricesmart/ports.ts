import type { CancellationInput, OrderInput, OrderView, Scope, State } from './contracts';

// Must resolve from an independently authenticated M2M identity, never body/header tenant IDs.
// No implementation is supplied in API-01. Resolve afresh for revocation on every operation.
export interface IdentityPort { resolve(): Promise<unknown | null> }
export type StoredOrder = {
  id: string; input: OrderInput; inputHash: string; state: State; version: number;
  correlationId: string; receivedAt: string; receipt: OrderView;
  cancellationHash: string | null; cancellationReceipt: OrderView | null;
  cancellationReason: CancellationInput['reason'] | null;
  tmsLinked: boolean;
};
export type Audit = { operation: 'RECEIVE' | 'REPLAY' | 'READ' | 'CANCEL' | 'CANCEL_REPLAY'; result: 'CREATED' | 'REPLAYED' | 'FOUND' | 'REQUESTED'; orderId: string; correlationId: string };
export type Event = { orderId: string; version: number; type: 'RECEIVED' | 'CANCELLATION_REQUESTED'; reason: CancellationInput['reason'] | null; correlationId: string };
export class UniqueOrderCollision extends Error { constructor() { super('UNIQUE_ORDER'); } }
export interface Transaction {
  // Scope fixed by repository before callback. Every query uses ALL Scope fields.
  insert(order: StoredOrder): Promise<void>;
  findForUpdate(externalOrderId: string): Promise<StoredOrder | null>;
  save(order: StoredOrder, previousVersion: number): Promise<void>;
  appendEvent(event: Event): Promise<void>;
  appendAudit(audit: Audit): Promise<void>;
  enqueue(event: Event): Promise<void>;
}
export type Committed<T> = { value: T; durability: 'DURABLE' | 'SIMULATED' };
export interface OrderRepository {
  // Atomic transaction: insert/update + event + audit + outbox, rollback on any failure.
  // Resolve ONLY after commit; reject unknown commit outcomes. UniqueOrderCollision must
  // be mapped ONLY from the order identity unique constraint, never an unrelated duplicate.
  // No driver/SQL implementation is supplied. A test fake MUST report SIMULATED.
  runAtomic<T>(scope: Scope, action: (tx: Transaction) => Promise<T>): Promise<Committed<T>>;
}
