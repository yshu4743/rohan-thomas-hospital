import type {
  RequestKind,
  ServiceRequest,
  RequestStatus,
  Session,
  StockItem,
  StockOrder,
  StockOrderStatus,
} from './types';
import fs from 'node:fs';
import path from 'node:path';

class SessionStore {
  private sessions = new Map<string, Session>();
  private seenMessages = new Map<string, number>();

  getOrCreate(phone: string): Session {
    const existing = this.sessions.get(phone);
    if (existing) return existing;

    const now = Date.now();
    const session: Session = {
      phone,
      state: 'MAIN_MENU',
      data: {},
      fallbackCount: 0,
      turns: 0,
      createdAt: now,
      lastSeen: now,
    };
    this.sessions.set(phone, session);
    return session;
  }

  get(phone: string): Session | undefined {
    return this.sessions.get(phone);
  }

  reset(phone: string): Session {
    const session = this.getOrCreate(phone);
    session.state = 'MAIN_MENU';
    session.data = {};
    session.fallbackCount = 0;
    session.turns = 0;
    session.handoffReason = undefined;
    session.lastSeen = Date.now();
    return session;
  }

  /** Returns false when Meta retries a message we already handled. */
  markSeen(messageId: string): boolean {
    if (!messageId) return true;
    if (this.seenMessages.has(messageId)) return false;
    this.seenMessages.set(messageId, Date.now());

    // Keep the dedupe map bounded.
    if (this.seenMessages.size > 5000) {
      const cutoff = Date.now() - 6 * 60 * 60 * 1000;
      for (const [id, at] of this.seenMessages) {
        if (at < cutoff) this.seenMessages.delete(id);
      }
    }
    return true;
  }
}

class RequestStore {
  private requests = new Map<string, ServiceRequest>();
  private counter = 0;

  create(kind: RequestKind, phone: string, details: Record<string, string>, note?: string): ServiceRequest {
    const now = Date.now();
    const request: ServiceRequest = {
      id: this.nextId(now),
      kind,
      phone,
      details,
      note,
      status: 'PENDING_STAFF',
      createdAt: now,
      updatedAt: now,
    };
    this.requests.set(request.id, request);
    return request;
  }

  get(id: string): ServiceRequest | undefined {
    return this.requests.get(id);
  }

  list(status?: RequestStatus): ServiceRequest[] {
    const all = [...this.requests.values()].sort((a, b) => b.createdAt - a.createdAt);
    return status ? all.filter((request) => request.status === status) : all;
  }

  updateStatus(id: string, status: RequestStatus): ServiceRequest | undefined {
    const request = this.requests.get(id);
    if (!request) return undefined;
    request.status = status;
    request.updatedAt = Date.now();
    return request;
  }

  private nextId(now: number): string {
    this.counter += 1;
    const date = new Date(now);
    const stamp = [
      date.getFullYear().toString().slice(-2),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('');
    const suffix = String(this.counter).padStart(4, '0');
    return `RT-${stamp}-${suffix}`;
  }
}

export const store = new SessionStore();
export const requests = new RequestStore();

class StockOrderStore {
  private orders = new Map<string, StockOrder>();
  private counter = 0;

  constructor(
    private readonly file = process.env.STOCK_ORDERS_FILE ??
      path.join(process.cwd(), 'data', 'stock-orders.json'),
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as { orders?: StockOrder[] };
      for (const order of parsed.orders ?? []) {
        this.orders.set(order.id, order);
        const sequence = Number(order.id.split('-').pop());
        if (Number.isFinite(sequence)) this.counter = Math.max(this.counter, sequence);
      }
    } catch {
      // No file yet (first run) — start empty.
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      this.file,
      JSON.stringify({ orders: [...this.orders.values()] }, null, 2),
    );
  }

  create(input: {
    items: StockItem[];
    supplier?: string;
    urgency?: string;
    note?: string;
    requestedBy?: string;
  }): StockOrder {
    const now = Date.now();
    const order: StockOrder = {
      id: this.nextId(now),
      items: input.items,
      supplier: input.supplier,
      urgency: input.urgency,
      note: input.note,
      requestedBy: input.requestedBy,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    this.persist();
    return order;
  }

  get(id: string): StockOrder | undefined {
    return this.orders.get(id);
  }

  list(status?: StockOrderStatus): StockOrder[] {
    const all = [...this.orders.values()].sort((a, b) => b.createdAt - a.createdAt);
    return status ? all.filter((order) => order.status === status) : all;
  }

  updateStatus(id: string, status: StockOrderStatus): StockOrder | undefined {
    const order = this.orders.get(id);
    if (!order) return undefined;
    order.status = status;
    order.updatedAt = Date.now();
    this.persist();
    return order;
  }

  recordReply(id: string, text: string): StockOrder | undefined {
    const order = this.orders.get(id);
    if (!order) return undefined;
    order.supplierReply = text;
    order.replyAt = Date.now();
    order.updatedAt = Date.now();
    this.persist();
    return order;
  }

  addItem(id: string, item: StockItem): StockOrder | undefined {
    const order = this.orders.get(id);
    if (!order) return undefined;
    order.items.push(item);
    order.updatedAt = Date.now();
    this.persist();
    return order;
  }

  removeItem(id: string, index: number): StockOrder | undefined {
    const order = this.orders.get(id);
    if (!order || index < 0 || index >= order.items.length) return undefined;
    order.items.splice(index, 1);
    order.updatedAt = Date.now();
    this.persist();
    return order;
  }

  private nextId(now: number): string {
    this.counter += 1;
    const date = new Date(now);
    const stamp = [
      date.getFullYear().toString().slice(-2),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('');
    return `PO-${stamp}-${String(this.counter).padStart(4, '0')}`;
  }
}

export const stockOrders = new StockOrderStore();
