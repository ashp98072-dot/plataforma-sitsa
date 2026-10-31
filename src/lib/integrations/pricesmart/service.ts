import { createHash, randomUUID } from 'node:crypto';
import { cancellationSchema, canTransition, OrderError, orderSchema, parseBody, principalSchema, reference, scopeOf, type OrderView, type Principal } from './contracts';
import { UniqueOrderCollision, type Committed, type IdentityPort, type OrderRepository, type StoredOrder, type Transaction } from './ports';

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function view(order: StoredOrder): OrderView {
  return { externalOrderId: order.input.externalOrderId, provisionalStatus: order.state,
    processingStatus: order.state === 'RECEIVED' ? 'PENDING' : order.state === 'CANCELLED' ? 'CANCELLED' : 'PAUSED',
    version: order.version, correlationId: order.correlationId };
}
export class OrderApplication {
  constructor(private readonly identity: IdentityPort, private readonly repository: OrderRepository) {}
  private async principal(scope: Principal['scopes'][number]): Promise<Principal> {
    try {
      const input = await this.identity.resolve();
      if (input === null) throw new OrderError('UNAUTHENTICATED');
      const result = principalSchema.safeParse(input);
      if (!result.success) throw new OrderError('UNAUTHENTICATED');
      if (!result.data.scopes.includes(scope)) throw new OrderError('FORBIDDEN');
      return result.data;
    } catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('UNAVAILABLE'); }
  }
  private async safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('UNAVAILABLE'); }
  }
  private externalId(id: unknown): string {
    const result = reference.safeParse(id);
    if (!result.success) throw new OrderError('INVALID_INPUT');
    return result.data;
  }
  private async owned(tx: Transaction, p: Principal, id: string): Promise<StoredOrder> {
    const order = await tx.findForUpdate(id);
    if (!order || order.input.originClubReference !== p.originClubReference) throw new OrderError('NOT_FOUND');
    return order;
  }
  async receive(body: Uint8Array): Promise<Committed<OrderView>> {
    const p = await this.principal('orders:create');
    const input = parseBody(body, orderSchema);
    if (input.originClubReference !== p.originClubReference) throw new OrderError('FORBIDDEN');
    // Explicit field order: stable under JSON property reordering, no ID normalization.
    const inputHash = hash([input.schemaVersion, input.externalOrderId, input.originClubReference]);
    const correlationId = randomUUID();
    return this.safe(async () => {
      try {
        return await this.repository.runAtomic(scopeOf(p), async tx => {
          const order: StoredOrder = { id: randomUUID(), input, inputHash, state: 'RECEIVED', version: 1,
            correlationId, receivedAt: new Date().toISOString(), receipt: {} as OrderView,
            cancellationHash: null, cancellationReceipt: null, cancellationReason: null, tmsLinked: false };
          order.receipt = view(order);
          await tx.insert(order); // Database UNIQUE decides concurrent creates, no read-before-insert.
          const event = { orderId: order.id, version: 1, type: 'RECEIVED' as const, reason: null, correlationId };
          await tx.appendEvent(event); await tx.enqueue(event);
          await tx.appendAudit({ operation: 'RECEIVE', result: 'CREATED', orderId: order.id, correlationId });
          return order.receipt;
        });
      } catch (error) {
        if (!(error instanceof UniqueOrderCollision)) throw error;
        // Fresh transaction after the losing transaction has rolled back; read committed winner.
        return this.repository.runAtomic(scopeOf(p), async tx => {
          const order = await tx.findForUpdate(input.externalOrderId);
          if (!order) throw new OrderError('UNAVAILABLE');
          if (order.inputHash !== inputHash) throw new OrderError('CONFLICT');
          await tx.appendAudit({ operation: 'REPLAY', result: 'REPLAYED', orderId: order.id, correlationId });
          return order.receipt; // Immutable original receipt, even after cancellation.
        });
      }
    });
  }
  async get(id: unknown): Promise<Committed<OrderView>> {
    const p = await this.principal('orders:read'); const externalId = this.externalId(id);
    return this.safe(() => this.repository.runAtomic(scopeOf(p), async tx => {
      const order = await this.owned(tx, p, externalId);
      await tx.appendAudit({ operation: 'READ', result: 'FOUND', orderId: order.id, correlationId: randomUUID() });
      return view(order);
    }));
  }
  async requestCancellation(id: unknown, body: Uint8Array): Promise<Committed<OrderView>> {
    const p = await this.principal('orders:cancel'); const externalId = this.externalId(id);
    const input = parseBody(body, cancellationSchema); const cancellationHash = hash([input.reason]);
    return this.safe(() => this.repository.runAtomic(scopeOf(p), async tx => {
      const order = await this.owned(tx, p, externalId); const correlationId = randomUUID();
      if (order.cancellationReceipt) {
        if (order.cancellationHash !== cancellationHash) throw new OrderError('CONFLICT');
        await tx.appendAudit({ operation: 'CANCEL_REPLAY', result: 'REPLAYED', orderId: order.id, correlationId });
        return order.cancellationReceipt;
      }
      if (order.tmsLinked || !canTransition(order.state, 'CANCELLATION_REQUESTED')) throw new OrderError('CONFLICT');
      const previousVersion = order.version;
      order.state = 'CANCELLATION_REQUESTED'; order.version++; order.cancellationHash = cancellationHash;
      order.cancellationReason = input.reason;
      order.cancellationReceipt = view(order);
      await tx.save(order, previousVersion);
      const event = { orderId: order.id, version: order.version, type: 'CANCELLATION_REQUESTED' as const, reason: input.reason, correlationId };
      await tx.appendEvent(event); await tx.enqueue(event);
      await tx.appendAudit({ operation: 'CANCEL', result: 'REQUESTED', orderId: order.id, correlationId });
      return order.cancellationReceipt;
    }));
  }
}
