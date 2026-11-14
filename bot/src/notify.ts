import { config } from './config';
import { requests } from './store';
import type { ServiceRequest } from './types';
import { sendText } from './whatsapp';

export interface StaffNotice {
  title: string;
  phone: string;
  lines: string[];
  requestId?: string;
}

const KIND_LABEL: Record<ServiceRequest['kind'], string> = {
  appointment: 'Appointment request',
  medicine: 'Medicine enquiry',
  document: 'Document request',
  prescription: 'Prescription received',
  handoff: 'Conversation handed over',
};

function format(notice: StaffNotice): string {
  return [
    `*${notice.title}*`,
    `Patient: +${notice.phone}`,
    ...notice.lines,
    notice.requestId ? `Ref: ${notice.requestId}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Sends the same notice to every staff channel:
 *  - console (always, so nothing is lost)
 *  - STAFF_INBOX_WEBHOOK, if configured
 *  - each number in STAFF_WHATSAPP_NUMBERS
 */
export async function notifyStaff(notice: StaffNotice): Promise<void> {
  const body = format(notice);
  console.log(`[staff] ${body.replace(/\n/g, ' | ')}`);

  if (config.staffInboxWebhook) {
    try {
      await fetch(config.staffInboxWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...notice, body, sentAt: new Date().toISOString() }),
      });
    } catch (error) {
      console.error('[staff] inbox webhook failed', error);
    }
  }

  await Promise.allSettled(config.staffNumbers.map((number) => sendText(number, body)));
}

export async function notifyNewRequest(request: ServiceRequest): Promise<void> {
  const details = Object.entries(request.details)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`);

  await notifyStaff({
    title: `New ${KIND_LABEL[request.kind]}`,
    phone: request.phone,
    requestId: request.id,
    lines: [...details, request.note ? `Note: ${request.note}` : ''].filter(Boolean),
  });
}

export async function notifyHandoff(phone: string, reason: string, transcript: string[]): Promise<ServiceRequest> {
  const request = requests.create('handoff', phone, { reason }, transcript.join('\n'));
  await notifyStaff({
    title: KIND_LABEL.handoff,
    phone,
    requestId: request.id,
    lines: [
      `Reason: ${reason}`,
      '--- recent messages ---',
      ...transcript,
      '--- end ---',
      'Reply from /admin/requests/:id/reply, then resume the bot when done.',
    ],
  });
  return request;
}
