import { Router } from 'express';
import { config } from './config';
import { requests, stockOrders, store } from './store';
import type { RequestStatus, StockItem, StockOrderStatus } from './types';
import { sendText } from './whatsapp';

const STATUSES: RequestStatus[] = ['PENDING_STAFF', 'CONTACTED', 'COMPLETED', 'CANCELLED'];
const STOCK_STATUSES: StockOrderStatus[] = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'];

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  if (!config.adminKey) {
    res.status(503).json({ error: 'ADMIN_KEY is not configured on the server' });
    return;
  }
  if (req.header('x-admin-key') !== config.adminKey) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

/** GET /admin/requests?status=PENDING_STAFF — the staff queue. */
adminRouter.get('/requests', (req, res) => {
  const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
  const status = raw && STATUSES.includes(raw as RequestStatus) ? (raw as RequestStatus) : undefined;
  res.json({ requests: requests.list(status) });
});

adminRouter.get('/requests/:id', (req, res) => {
  const request = requests.get(req.params.id);
  if (!request) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ request });
});

/** POST /admin/requests/:id/status — { "status": "COMPLETED" } */
adminRouter.post('/requests/:id/status', (req, res) => {
  const status = String(req.body?.status ?? '') as RequestStatus;
  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
    return;
  }
  const request = requests.updateStatus(req.params.id, status);
  if (!request) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ request });
});

/** POST /admin/requests/:id/reply — { "text": "..." } sends a WhatsApp message to the patient. */
adminRouter.post('/requests/:id/reply', async (req, res) => {
  const request = requests.get(req.params.id);
  if (!request) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const text = String(req.body?.text ?? '').trim();
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const result = await sendText(request.phone, text);
  const updated = requests.updateStatus(request.id, 'CONTACTED');
  res.status(result.ok ? 200 : 502).json({ ok: result.ok, request: updated, error: result.error });
});

/** POST /admin/requests/:id/resume — hand the conversation back to the bot. */
adminRouter.post('/requests/:id/resume', async (req, res) => {
  const request = requests.get(req.params.id);
  if (!request) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  store.reset(request.phone);
  requests.updateStatus(request.id, 'COMPLETED');
  await sendText(
    request.phone,
    'You are back with the automated assistant. Reply *menu* for appointments, medicines or documents, or *4* for a staff member.',
  );
  res.json({ ok: true });
});

// ── Hospital stock orders (procurement) ──────────────────────────────────
// These are the hospital's own purchase requirements, not patient enquiries.

/** GET /admin/stock-orders?status=DRAFT — the purchase list. */
adminRouter.get('/stock-orders', (req, res) => {
  const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
  const status = raw && STOCK_STATUSES.includes(raw as StockOrderStatus)
    ? (raw as StockOrderStatus)
    : undefined;
  res.json({ orders: stockOrders.list(status) });
});

adminRouter.get('/stock-orders/:id', (req, res) => {
  const order = stockOrders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ order });
});

/** GET /admin/stock-orders/:id/text — the order as plain text, ready to send. */
adminRouter.get('/stock-orders/:id/text', (req, res) => {
  const order = stockOrders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const lines = [
    `PURCHASE ORDER ${order.id}`,
    `Date: ${new Date(order.createdAt).toLocaleString('en-IN', { timeZone: config.timezone })}`,
    `Supplier: ${order.supplier ?? config.stockSupplier}`,
    `Buyer: ${config.hospitalName} Pharmacy, Karukutty, Angamaly, Kerala`,
    '',
    'Items:',
    ...order.items.map((item, index) => `  ${index + 1}. ${item.name} — ${item.quantity}`),
    '',
    `Urgency: ${order.urgency ?? 'normal'}`,
    order.note ? `Notes: ${order.note}` : '',
    order.requestedBy ? `Requested by: ${order.requestedBy}` : '',
    `Status: ${order.status}`,
    order.supplierReply
      ? `Supplier reply (${new Date(order.replyAt ?? order.updatedAt).toLocaleString('en-IN', { timeZone: config.timezone })}): ${order.supplierReply}`
      : '',
    '',
    'Hospital stock replenishment order. Batch number and expiry date required on delivery.',
  ].filter((line) => line !== '');

  res.type('text/plain').send(lines.join('\n'));
});

/** POST /admin/stock-orders — { items:[{name,quantity}], supplier?, urgency?, note?, requestedBy? } */
adminRouter.post('/stock-orders', (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const items: StockItem[] = rawItems
    .map((item: unknown) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return {
        name: String(record.name ?? '').trim(),
        quantity: String(record.quantity ?? '').trim(),
      };
    })
    .filter((item: StockItem) => item.name && item.quantity);

  if (items.length === 0) {
    res.status(400).json({ error: 'items must be a non-empty array of { name, quantity }' });
    return;
  }

  const order = stockOrders.create({
    items,
    supplier: String(req.body?.supplier ?? '').trim() || config.stockSupplier,
    urgency: String(req.body?.urgency ?? '').trim() || undefined,
    note: String(req.body?.note ?? '').trim() || undefined,
    requestedBy: String(req.body?.requestedBy ?? '').trim() || undefined,
  });

  console.log(`[stock] ${order.id} ${items.map((item) => `${item.name} x ${item.quantity}`).join(', ')}`);
  res.status(201).json({ order });
});

/** POST /admin/stock-orders/:id/items — { name, quantity } appends one item. */
adminRouter.post('/stock-orders/:id/items', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const quantity = String(req.body?.quantity ?? '').trim();
  if (!name || !quantity) {
    res.status(400).json({ error: 'name and quantity are required' });
    return;
  }
  const order = stockOrders.addItem(req.params.id, { name, quantity });
  if (!order) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.status(201).json({ order });
});

/** DELETE /admin/stock-orders/:id/items/:index — remove an item by position (0-based). */
adminRouter.delete('/stock-orders/:id/items/:index', (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index)) {
    res.status(400).json({ error: 'index must be an integer' });
    return;
  }
  const order = stockOrders.removeItem(req.params.id, index);
  if (!order) {
    res.status(404).json({ error: 'not found or index out of range' });
    return;
  }
  res.json({ order });
});

/** POST /admin/stock-orders/:id/reply — { "text": "..." } records what the supplier said. */
adminRouter.post('/stock-orders/:id/reply', (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const order = stockOrders.recordReply(req.params.id, text);
  if (!order) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ order });
});

/** POST /admin/stock-orders/:id/status — { "status": "ORDERED" | "RECEIVED" | "CANCELLED" } */
adminRouter.post('/stock-orders/:id/status', (req, res) => {
  const status = String(req.body?.status ?? '') as StockOrderStatus;
  if (!STOCK_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of ${STOCK_STATUSES.join(', ')}` });
    return;
  }
  const order = stockOrders.updateStatus(req.params.id, status);
  if (!order) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ order });
});
