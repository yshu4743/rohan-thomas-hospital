# WhatsApp front desk bot — Rohan Thomas Hospital

Node.js + TypeScript bot on the **Meta WhatsApp Cloud API**.

It does four things:

1. Book appointment requests
2. Take medicine availability / refill enquiries
3. Take **document requests** and route them to authorised staff
4. **Hand the conversation to a human** when it gets complicated

It deliberately does **not** generate, render, reprint or "recreate" a medical
certificate, drug licence, or any other official document. The bot records the
request and passes it to the person who is authorised to issue it. A generated
look-alike would be a forged document.

---

## 1. Setup

```bash
cd bot
cp .env.example .env
npm install
```

Fill in `.env`. To try it without Meta credentials:

```bash
# .env
BOT_DRY_RUN=true
ADMIN_KEY=some-long-random-string
```

```bash
npm run dev
```

Test a message without WhatsApp:

```bash
curl -s localhost:3000/dev/message \
  -H 'content-type: application/json' \
  -d '{"from":"919876543210","text":"hi"}'
```

The reply is printed to the terminal (`[dry-run] → +91...`). The session state is
echoed back in the JSON response.

With real credentials, set `BOT_DRY_RUN=false` and fill in the Meta values, then:

```bash
npm run build && npm start
```

---

## 2. Meta Cloud API wiring

1. [developers.facebook.com](https://developers.facebook.com) → create an app →
   add the **WhatsApp** product.
2. Copy the **Phone number ID** and a **permanent access token** into `.env`
   (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`).
3. App settings → Basic → copy the **App secret** into `WHATSAPP_APP_SECRET`
   (this is what makes webhook signature checks work).
4. Pick a random `WHATSAPP_VERIFY_TOKEN`.
5. Expose the server over HTTPS (Railway / Render / Fly / a VPS with Caddy) and
   set the webhook to:

   ```
   https://your-domain/webhook
   ```

   Verify token = the same string. Subscribe to the **messages** field.
6. Add the recipient numbers as test numbers while the app is in development
   mode, then go live.

The server answers Meta with `200` immediately and processes in the background,
so retries don't duplicate replies. Message IDs are deduplicated.

---

## 3. How the handoff works

A conversation is escalated to staff when **any** of these happens:

| Trigger | Examples |
|---|---|
| Explicit request | "talk to a person", "manager", "reception" |
| Possible emergency | "chest pain", "can't breathe", "bleeding" |
| Complaint / clinical concern | "wrong medicine", "side effect", "refund", "police" |
| Negative sentiment | "useless", "no response", "cheat" |
| Two unrecognised replies in a row | — |
| More than 20 turns without resolution | — |

On escalation the bot:

1. Puts the chat in `HANDOFF` state and stops replying on its own.
2. Creates a ticket (`RT-YYMMDD-NNNN`) with the last 12 messages.
3. Notifies staff — console, `STAFF_INBOX_WEBHOOK`, and every number in
   `STAFF_WHATSAPP_NUMBERS`.
4. Tells the patient a staff member will reply, and gives the ticket number.
5. Forwards anything the patient sends while waiting.

After `HANDOFF_PAUSE_MINUTES`, the patient can type `menu` to return to the bot.
Staff can also hand back explicitly:

```bash
curl -X POST localhost:3000/admin/requests/RT-251113-0001/resume \
  -H "x-admin-key: $ADMIN_KEY"
```

---

## 4. Staff admin API

Every call needs `x-admin-key: <ADMIN_KEY>`.

```bash
# the queue
curl -s localhost:3000/admin/requests?status=PENDING_STAFF -H "x-admin-key: $ADMIN_KEY"

# reply to the patient on WhatsApp
curl -s -X POST localhost:3000/admin/requests/RT-251113-0001/reply \
  -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"text":"Your certificate is ready at the records counter."}'

# mark done
curl -s -X POST localhost:3000/admin/requests/RT-251113-0001/status \
  -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"status":"COMPLETED"}'
```

Statuses: `PENDING_STAFF`, `CONTACTED`, `COMPLETED`, `CANCELLED`.

There is no admin UI yet. The API is enough to connect a Google Sheet, Retool,
n8n, or a small internal page later.

### Hospital stock orders (procurement)

Patient medicine enquiries are **not** purchase orders. To replenish the
pharmacy's own stock, use the stock-order endpoints (same `x-admin-key`):

```bash
# create
curl -s -X POST localhost:3000/admin/stock-orders \
  -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"items":[{"name":"Lox 2% injection 2ml","quantity":"1 box"}],
       "urgency":"low stock","requestedBy":"Pharmacy"}'

# the list
curl -s localhost:3000/admin/stock-orders -H "x-admin-key: $ADMIN_KEY"

# mark ordered / received / cancelled
curl -s -X POST localhost:3000/admin/stock-orders/PO-251113-0001/status \
  -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"status":"ORDERED"}'
```

Statuses: `DRAFT`, `ORDERED`, `RECEIVED`, `CANCELLED`. The API records the
requirement and the audit trail; it does not send anything to a distributor.

The supplier defaults to `STOCK_SUPPLIER` (set to `Leo Pharma, Thrissur` in
`.env`). To get a printable order:

```bash
curl -s localhost:3000/admin/stock-orders/PO-251113-0001/text \
  -H "x-admin-key: $ADMIN_KEY"

# record what the supplier actually said (verbatim, never generated)
curl -s -X POST localhost:3000/admin/stock-orders/PO-251113-0001/reply \
  -H "x-admin-key: $ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"text":"Phenergan 1 box available, nitrazepam out of stock, delivery Friday."}'
```

Stock orders are persisted to `data/stock-orders.json` (gitignored), so a
restart no longer erases them. The bot itself still does not contact the
supplier — the reply is entered by staff.

---

## 5. Document requests — the boundary

When someone picks option 3, the bot collects document type, patient name,
patient ID/OP number, and purpose. It then writes a `document` ticket and tells
the patient:

> The medical records desk checks the register. The authorised signatory reviews
> it. If the record supports it, the document is issued with the hospital's
> signature and seal. The bot cannot generate or print certificates.

For "drug licence document" it adds that a licence is government-issued, can only
be shared by the licensee, and cannot be reprinted here.

To actually issue a document, staff use the hospital's existing register and
letterhead — outside this bot. The bot is the intake and the paper trail, not the
printer.

---

## 6. Data and privacy

Sessions and tickets are **in memory** (`src/store.ts`). Restarting the process
clears them. Before real use:

- Swap `SessionStore` / `RequestStore` for Redis or Postgres (the interfaces are
  small and isolated).
- Decide a retention period for ticket transcripts; medical data should not sit
  in memory or logs longer than needed.
- Do not log message bodies in production (`notify.ts` and `whatsapp.ts` log
  outbound text).
- Prescription images/PDFs are written to `data/prescriptions/` (gitignored).
  They are medical records: set a retention period, restrict filesystem access,
  and delete them when no longer needed. In dry-run they are not downloaded —
  only the media id is recorded.
- Put the admin API behind the same HTTPS reverse proxy and a strong
  `ADMIN_KEY`. Rotate it if a phone is lost.

---

## 7. Files

```
src/
  config.ts        env parsing and startup checks
  types.ts         session, ticket, state types
  store.ts         in-memory sessions + tickets (swap for a DB)
  whatsapp.ts      Cloud API send / mark-read
  notify.ts        staff notifications (console, webhook, WhatsApp)
  conversation.ts  menu, flows, escalation rules
  webhook.ts       Meta verification + inbound parsing
  media.ts         prescription image/PDF download to data/prescriptions/
  admin.ts         staff queue / reply / resume API
  index.ts         Express wiring + dry-run simulator
```
