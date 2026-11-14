import express, { type NextFunction, type Request, type Response } from 'express';
import { adminRouter } from './admin';
import { assertProductionConfig, config } from './config';
import { handleIncoming, handlePrescriptionMedia } from './conversation';
import { requests, store } from './store';
import { webhookRouter } from './webhook';

const app = express();

// Keep the raw body so X-Hub-Signature-256 can be verified.
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    dryRun: config.dryRun,
    hospital: config.hospitalName,
    pendingStaff: requests.list('PENDING_STAFF').length,
  });
});

app.use('/webhook', webhookRouter);
app.use('/admin', adminRouter);

// Local testing without Meta credentials. Only mounted in dry-run mode.
if (config.dryRun) {
  app.post('/dev/message', async (req, res) => {
    const from = String(req.body?.from ?? '919999999999').replace(/\D/g, '');
    const text = String(req.body?.text ?? '').trim();

    if (req.body?.mediaId) {
      await handlePrescriptionMedia({
        from,
        mediaId: String(req.body.mediaId),
        mimeType: req.body?.mimeType ? String(req.body.mimeType) : undefined,
        filename: req.body?.filename ? String(req.body.filename) : undefined,
        id: `dev-media-${Date.now()}-${Math.random()}`,
      });
      res.json({ ok: true, session: store.get(from) });
      return;
    }

    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    await handleIncoming({ from, text, id: `dev-${Date.now()}-${Math.random()}` });
    res.json({ ok: true, session: store.get(from) });
  });
  console.log('[dev] POST /dev/message { "from": "9199...", "text": "hi" }');
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error', error);
  res.status(500).json({ error: 'internal error' });
});

assertProductionConfig();

app.listen(config.port, () => {
  console.log(`[server] ${config.hospitalName} bot on :${config.port}`);
  if (!config.appSecret) {
    console.warn('[server] WHATSAPP_APP_SECRET is empty — webhook signatures are NOT verified');
  }
  if (!config.adminKey) {
    console.warn('[server] ADMIN_KEY is empty — the staff admin API is disabled');
  }
  if (config.staffNumbers.length === 0 && !config.staffInboxWebhook) {
    console.warn('[server] no staff notification channel configured — handoffs go to the console only');
  }
});
