import { config } from './config';
import { saveMedia } from './media';
import { notifyHandoff, notifyNewRequest } from './notify';
import { requests, store } from './store';
import type { IncomingMessage, Session } from './types';
import { markRead, sendText } from './whatsapp';

const MENU = `*${config.hospitalName}* 🏥

Reply with a number:

1. Book an appointment
2. Medicine availability / refill
3. Medical certificate or document request
4. Talk to a staff member
5. Timings & directions

Reply *menu* at any time.`;

const EMERGENCY_MESSAGE =
  '⚠️ This sounds like a medical emergency. Please call *108* for an ambulance or come to the emergency department now. Do not wait for a reply here.';

const EMERGENCY_PATTERN =
  /(chest pain|heart attack|can'?t breathe|cannot breathe|breathless|unconscious|not breathing|severe bleeding|bleeding heavily|stroke|seizure|overdose|poison|suicide|kill myself|emergency|accident|water broke|labour pain|labor pain)/i;

const SENSITIVE_PATTERN =
  /(complaint|refund|lawyer|legal notice|police|negligence|wrong medicine|adverse|side effect|allergic reaction|death|died|passed away)/i;

const HUMAN_PATTERN =
  /(talk (to|with) (a )?(human|person|someone|staff|manager|reception)|real person|human being|staff member|manager|receptionist)/i;

const NEGATIVE_PATTERN =
  /(useless|worst|angry|furious|terrible|no response|not responding|cheat|fraud)/i;

const CANCEL_PATTERN = /^(2|no|n|cancel|stop)$/i;
const YES_PATTERN = /^(1|yes|y|confirm|ok|okay)$/i;

/** Last few messages per phone number, used for the staff handoff summary. */
const transcripts = new Map<string, string[]>();

function remember(phone: string, line: string): void {
  const existing = transcripts.get(phone) ?? [];
  existing.push(line);
  transcripts.set(phone, existing.slice(-12));
}

async function send(session: Session, body: string): Promise<void> {
  const result = await sendText(session.phone, body);
  if (!result.ok) console.error(`[bot] failed to send to +${session.phone}`);
}

async function sendMenu(session: Session): Promise<void> {
  await send(session, MENU);
}

function officeOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  return hour >= 9 && hour < 20;
}

function clear(session: Session): void {
  session.state = 'MAIN_MENU';
  session.data = {};
  session.fallbackCount = 0;
}

// ── Escalation ───────────────────────────────────────────────────────────

interface Escalation {
  reason: string;
  message?: string;
}

function detectEscalation(session: Session, text: string): Escalation | null {
  if (EMERGENCY_PATTERN.test(text)) {
    return { reason: 'possible medical emergency', message: EMERGENCY_MESSAGE };
  }
  if (SENSITIVE_PATTERN.test(text)) {
    return { reason: 'complaint or clinical concern' };
  }
  if (HUMAN_PATTERN.test(text)) {
    return { reason: 'patient asked for a staff member' };
  }
  if (NEGATIVE_PATTERN.test(text)) {
    return { reason: 'negative sentiment' };
  }
  if (session.turns > 20) {
    return { reason: 'long conversation without resolution' };
  }
  return null;
}

export async function startHandoff(
  session: Session,
  reason: string,
  message?: string,
): Promise<void> {
  if (session.state === 'HANDOFF') return;

  session.state = 'HANDOFF';
  session.handoffReason = reason;
  session.data = { handoffAt: String(Date.now()) };

  const transcript = (transcripts.get(session.phone) ?? []).slice(-12);
  const request = await notifyHandoff(session.phone, reason, transcript);
  session.data.handoffRef = request.id;

  const opening = message
    ? `${message}\n\n`
    : 'I am connecting you with a member of our front desk. They will reply here.\n\n';

  const timing = officeOpen()
    ? 'Our staff are online now.'
    : 'Our front desk is closed right now, so the reply will come when it opens (9:00 am).';

  await send(
    session,
    `${opening}${timing}\n\nYour reference: *${request.id}*\nIf this is a medical emergency, call *108* now.`,
  );
}

async function relayToStaff(session: Session, text: string): Promise<void> {
  remember(session.phone, `Patient: ${text}`);

  if (!session.data.relayed) {
    session.data.relayed = '1';
    await send(
      session,
      `Thank you — I have passed this to the front desk. Reference *${session.data.handoffRef ?? ''}*. A staff member will reply here.`,
    );
  }

  const { notifyStaff } = await import('./notify');
  await notifyStaff({
    title: 'Message while handed over',
    phone: session.phone,
    requestId: session.data.handoffRef,
    lines: [text],
  });
}

// ── Entry point ──────────────────────────────────────────────────────────

export async function handleIncoming(message: IncomingMessage): Promise<void> {
  if (!store.markSeen(message.id)) return;

  const session = store.getOrCreate(message.from);
  session.lastSeen = Date.now();
  session.turns += 1;
  const text = message.text.trim();
  remember(session.phone, `Patient: ${text}`);
  void markRead(message.id);

  if (session.state === 'HANDOFF') {
    const pauseExpired =
      Date.now() - Number(session.data.handoffAt ?? 0) >
      config.handoffPauseMinutes * 60 * 1000;

    if (pauseExpired && /^(menu|start|hi|hello)$/i.test(text)) {
      store.reset(session.phone);
      await sendMenu(session);
      return;
    }

    await relayToStaff(session, text);
    return;
  }

  const escalation = detectEscalation(session, text);
  if (escalation) {
    await startHandoff(session, escalation.reason, escalation.message);
    return;
  }

  const consumed = await dispatch(session, text);
  if (consumed) {
    session.fallbackCount = 0;
  } else {
    await fallback(session);
  }
}

async function fallback(session: Session): Promise<void> {
  session.fallbackCount += 1;
  if (session.fallbackCount >= 2) {
    await startHandoff(session, 'repeated unrecognised replies');
    return;
  }
  await send(session, `I did not quite catch that. Reply with a number, or type *menu*.\n\n${MENU}`);
}

// ── Prescription images / PDFs ───────────────────────────────────────────

/**
 * Records an incoming prescription attachment. The bot stores it and raises a
 * ticket; it never reads, interprets or dispenses from the image. A pharmacist
 * must verify the original.
 */
export async function handlePrescriptionMedia(input: {
  from: string;
  mediaId: string;
  mimeType?: string;
  filename?: string;
  id: string;
}): Promise<void> {
  if (!store.markSeen(input.id)) return;

  const session = store.getOrCreate(input.from);
  session.lastSeen = Date.now();
  session.turns += 1;
  remember(session.phone, `Patient: sent a ${input.mimeType ?? 'file'} attachment`);

  const saved = await saveMedia(input.mediaId, input.mimeType, input.filename);

  const request = requests.create(
    'prescription',
    input.from,
    {
      mediaType: input.mimeType ?? 'unknown',
      file: saved.file ?? saved.note,
    },
    'Pharmacist must verify the original prescription before dispensing. Schedule H1 items need a register entry.',
  );
  await notifyNewRequest(request);

  await send(
    session,
    `*Prescription received* ✅
Reference: *${request.id}*

A pharmacist will check it and reply here. Please keep the original prescription with you — the pharmacy may need to see it when you collect.

Reply *menu* for anything else.`,
  );
}

// ── Router ───────────────────────────────────────────────────────────────

async function dispatch(session: Session, text: string): Promise<boolean> {
  switch (session.state) {
    case 'MAIN_MENU':
      return mainMenu(session, text);
    case 'APPT_NAME':
      return appointmentName(session, text);
    case 'APPT_DATE':
      return appointmentDate(session, text);
    case 'APPT_DEPT':
      return appointmentDepartment(session, text);
    case 'APPT_CONFIRM':
      return appointmentConfirm(session, text);
    case 'MED_NAME':
      return medicineName(session, text);
    case 'MED_QTY':
      return medicineQuantity(session, text);
    case 'MED_CONFIRM':
      return medicineConfirm(session, text);
    case 'DOC_TYPE':
      return documentType(session, text);
    case 'DOC_PATIENT':
      return documentPatient(session, text);
    case 'DOC_ID':
      return documentId(session, text);
    case 'DOC_PURPOSE':
      return documentPurpose(session, text);
    case 'DOC_CONFIRM':
      return documentConfirm(session, text);
    default:
      return false;
  }
}

// ── Main menu ────────────────────────────────────────────────────────────

async function mainMenu(session: Session, text: string): Promise<boolean> {
  const choice = text.trim().toLowerCase();

  if (/^(hi|hello|hey|start|menu|help|0)$/.test(choice)) {
    await sendMenu(session);
    return true;
  }

  switch (choice) {
    case '1':
    case 'appointment':
      session.state = 'APPT_NAME';
      session.data = {};
      await send(session, "Sure. What is the patient's full name?");
      return true;

    case '2':
    case 'medicine':
    case 'refill':
      session.state = 'MED_NAME';
      session.data = {};
      await send(
        session,
        'Which medicine do you need? Please include the strength if you know it (for example: Metformin 500mg).',
      );
      return true;

    case '3':
    case 'document':
    case 'certificate':
      session.state = 'DOC_TYPE';
      session.data = {};
      await send(
        session,
        `What document do you need?

1. Illness / leave certificate
2. Fitness certificate
3. Vaccination record
4. Pharmacy / drug licence document
5. Other document`,
      );
      return true;

    case '4':
    case 'staff':
    case 'human':
      await startHandoff(session, 'patient chose to talk to a staff member');
      return true;

    case '5':
    case 'timings':
    case 'directions':
      await send(
        session,
        `🕘 *OPD:* Mon–Sat, 9:00 am – 8:00 pm. Sunday 9:00 am – 1:00 pm.
🚑 *Emergency:* call 108.
📍 Karukutty, Angamaly, Kerala
☎️ +91 79948 04743

Reply *menu* for the main menu.`,
      );
      return true;

    default:
      return false;
  }
}

// ── Appointments ─────────────────────────────────────────────────────────

async function appointmentName(session: Session, text: string): Promise<boolean> {
  if (text.length < 2) {
    await send(session, 'Please send the full name of the patient.');
    return true;
  }
  session.data.patient = text;
  session.state = 'APPT_DATE';
  await send(session, 'Preferred date? Send DD-MM-YYYY, or type *today* / *tomorrow*.');
  return true;
}

async function appointmentDate(session: Session, text: string): Promise<boolean> {
  const normalised = text.trim().toLowerCase();
  const looksLikeDate =
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(normalised) ||
    ['today', 'tomorrow'].includes(normalised);

  if (!looksLikeDate) {
    await send(session, 'Please send the date as DD-MM-YYYY, or type *today* / *tomorrow*.');
    return true;
  }

  session.data.date = normalised;
  session.state = 'APPT_DEPT';
  await send(
    session,
    `Which department or doctor?

1. General medicine
2. Paediatrics
3. Gynaecology
4. Orthopaedics
5. Other (type the department name)`,
  );
  return true;
}

async function appointmentDepartment(session: Session, text: string): Promise<boolean> {
  if (text.trim().length < 2) {
    await send(session, 'Please reply with a department number or name.');
    return true;
  }
  session.data.department = text.trim();
  session.state = 'APPT_CONFIRM';

  await send(
    session,
    `Please confirm:

👤 Patient: ${session.data.patient}
📅 Date: ${session.data.date}
🏥 Department: ${session.data.department}

1. Confirm
2. Cancel`,
  );
  return true;
}

async function appointmentConfirm(session: Session, text: string): Promise<boolean> {
  if (CANCEL_PATTERN.test(text.trim())) {
    clear(session);
    await send(session, 'Cancelled. Nothing was booked.');
    await sendMenu(session);
    return true;
  }

  if (!YES_PATTERN.test(text.trim())) return false;

  const request = requests.create('appointment', session.phone, {
    patient: session.data.patient,
    preferredDate: session.data.date,
    department: session.data.department,
  });
  await notifyNewRequest(request);

  clear(session);
  await send(
    session,
    `*Appointment request ${request.id} received* ✅

Our front desk will confirm the exact slot and doctor by message. Please arrive 10 minutes early with any previous prescriptions.

Reply *menu* for anything else.`,
  );
  return true;
}

// ── Medicine enquiry ─────────────────────────────────────────────────────

async function medicineName(session: Session, text: string): Promise<boolean> {
  if (text.trim().length < 2) {
    await send(session, 'Please send the name of the medicine.');
    return true;
  }
  session.data.medicine = text.trim();
  session.state = 'MED_QTY';
  await send(session, 'How many boxes or strips do you need?');
  return true;
}

async function medicineQuantity(session: Session, text: string): Promise<boolean> {
  if (text.trim().length < 1) {
    await send(session, 'Please send a quantity, for example *2 boxes*.');
    return true;
  }
  session.data.quantity = text.trim();
  session.state = 'MED_CONFIRM';

  await send(
    session,
    `Please confirm:

💊 Medicine: ${session.data.medicine}
📦 Quantity: ${session.data.quantity}

1. Confirm
2. Cancel

We will check stock and price. Prescription medicines are dispensed only against a valid prescription.`,
  );
  return true;
}

async function medicineConfirm(session: Session, text: string): Promise<boolean> {
  if (CANCEL_PATTERN.test(text.trim())) {
    clear(session);
    await send(session, 'Cancelled.');
    await sendMenu(session);
    return true;
  }

  if (!YES_PATTERN.test(text.trim())) return false;

  const request = requests.create('medicine', session.phone, {
    medicine: session.data.medicine,
    quantity: session.data.quantity,
  });
  await notifyNewRequest(request);

  clear(session);
  await send(
    session,
    `*Enquiry ${request.id} received* ✅

The pharmacy will check availability and price and reply here. If it is a prescription medicine, bring or send the prescription — we cannot dispense without it.

Reply *menu* for anything else.`,
  );
  return true;
}

// ── Documents ────────────────────────────────────────────────────────────

const DOC_TYPES: Record<string, string> = {
  '1': 'Illness / leave certificate',
  '2': 'Fitness certificate',
  '3': 'Vaccination record',
  '4': 'Pharmacy / drug licence document',
  '5': 'Other document',
};

async function documentType(session: Session, text: string): Promise<boolean> {
  const key = text.trim();
  const label = DOC_TYPES[key];
  if (!label) {
    await send(session, 'Please reply with a number from 1 to 5.');
    return true;
  }

  session.data.documentType = label;
  session.state = 'DOC_PATIENT';
  await send(session, "What is the patient's full name as it appears in our records?");
  return true;
}

async function documentPatient(session: Session, text: string): Promise<boolean> {
  if (text.trim().length < 2) {
    await send(session, 'Please send the full name.');
    return true;
  }
  session.data.patient = text.trim();
  session.state = 'DOC_ID';
  await send(session, 'Patient ID / OP number? If you do not have one, type *new*.');
  return true;
}

async function documentId(session: Session, text: string): Promise<boolean> {
  if (text.trim().length < 1) {
    await send(session, 'Please send the patient ID, or type *new*.');
    return true;
  }
  session.data.patientId = text.trim();
  session.state = 'DOC_PURPOSE';
  await send(
    session,
    'What is the document for, and which dates should it cover? (for example: school leave, 10–12 Nov)',
  );
  return true;
}

async function documentPurpose(session: Session, text: string): Promise<boolean> {
  if (text.trim().length < 2) {
    await send(session, 'Please describe the purpose and dates.');
    return true;
  }
  session.data.purpose = text.trim();
  session.state = 'DOC_CONFIRM';

  const extra =
    session.data.documentType === 'Pharmacy / drug licence document'
      ? '\n\nNote: a drug licence is a government-issued document. It can only be shared by the licensee, and it cannot be reprinted or generated here.'
      : '';

  await send(
    session,
    `Please confirm:

📄 Document: ${session.data.documentType}
👤 Patient: ${session.data.patient}
🆔 Patient ID: ${session.data.patientId}
📝 Purpose: ${session.data.purpose}

1. Confirm
2. Cancel${extra}`,
  );
  return true;
}

async function documentConfirm(session: Session, text: string): Promise<boolean> {
  if (CANCEL_PATTERN.test(text.trim())) {
    clear(session);
    await send(session, 'Cancelled.');
    await sendMenu(session);
    return true;
  }

  if (!YES_PATTERN.test(text.trim())) return false;

  const request = requests.create(
    'document',
    session.phone,
    {
      documentType: session.data.documentType,
      patient: session.data.patient,
      patientId: session.data.patientId,
      purpose: session.data.purpose,
    },
    'Bot records the request only. Authorised staff must verify the register and issue any document.',
  );
  await notifyNewRequest(request);

  clear(session);
  await send(
    session,
    `*Document request ${request.id} recorded* ✅

What happens next:
1. The medical records desk checks the hospital register.
2. The authorised signatory reviews it.
3. If the record supports it, the document is issued to you with the hospital's signature and seal.

The bot cannot generate or print certificates — only the authorised person can issue one, and only for a real entry in the register.

A staff member will message you here. Reply *menu* for anything else.`,
  );
  return true;
}
