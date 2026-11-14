import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from './config';
import { handleIncoming, handlePrescriptionMedia } from './conversation';
import { sendText } from './whatsapp';

export const webhookRouter = Router();

interface MetaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; filename?: string; caption?: string };
}

interface MetaWebhook {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: MetaMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
}

/** GET /webhook — Meta's one-time verification handshake. */
webhookRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.verifyToken) {
    console.log('[webhook] verified');
    res.status(200).send(String(challenge ?? ''));
    return;
  }
  console.warn('[webhook] verification failed');
  res.sendStatus(403);
});

function signatureValid(req: Request): boolean {
  if (!config.appSecret) return true;

  const header = req.header('x-hub-signature-256');
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!header || !rawBody) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', config.appSecret)
    .update(rawBody)
    .digest('hex')}`;

  const received = Buffer.from(header);
  const computed = Buffer.from(expected);
  return received.length === computed.length && crypto.timingSafeEqual(received, computed);
}

function extractText(message: MetaMessage): string {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  return '';
}

/** POST /webhook — inbound messages. Acknowledge fast, then work. */
webhookRouter.post('/', (req: Request, res: Response) => {
  if (!signatureValid(req)) {
    console.warn('[webhook] bad signature');
    res.sendStatus(401);
    return;
  }

  // Meta retries anything that is not acknowledged quickly.
  res.sendStatus(200);

  const body = req.body as MetaWebhook;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        const from = message.from;
        const media = message.image ?? message.document;

        if (media?.id) {
          void handlePrescriptionMedia({
            from,
            mediaId: media.id,
            mimeType: media.mime_type,
            filename: message.document?.filename,
            id: message.id,
          }).catch((error) => console.error('[webhook] prescription handler failed', error));
          continue;
        }

        const text = extractText(message);

        if (!text) {
          void sendText(
            from,
            'I can read text and prescription photos/PDFs. For voice notes or other files, please type your question or reply *menu*.',
          ).catch((error) => console.error('[webhook] non-text reply failed', error));
          continue;
        }

        void handleIncoming({ from, text, id: message.id }).catch((error) =>
          console.error('[webhook] handler failed', error),
        );
      }
    }
  }
});
