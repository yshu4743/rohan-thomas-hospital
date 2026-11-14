import { config } from './config';

interface SendResult {
  ok: boolean;
  error?: string;
}

const GRAPH_URL = 'https://graph.facebook.com';

export async function sendText(to: string, body: string): Promise<SendResult> {
  if (config.dryRun) {
    console.log(`[dry-run] → +${to}\n${body}\n`);
    return { ok: true };
  }

  if (!config.phoneNumberId || !config.accessToken) {
    console.error('[whatsapp] missing credentials, message not sent');
    return { ok: false, error: 'missing credentials' };
  }

  try {
    const response = await fetch(
      `${GRAPH_URL}/${config.graphVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[whatsapp] send failed', response.status, error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (error) {
    console.error('[whatsapp] send threw', error);
    return { ok: false, error: String(error) };
  }
}

export async function markRead(messageId: string): Promise<void> {
  if (config.dryRun || !messageId || !config.phoneNumberId || !config.accessToken) return;
  try {
    await fetch(`${GRAPH_URL}/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  } catch (error) {
    console.error('[whatsapp] markRead failed', error);
  }
}
