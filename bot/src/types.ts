export type ChatState =
  | 'MAIN_MENU'
  | 'APPT_NAME'
  | 'APPT_DATE'
  | 'APPT_DEPT'
  | 'APPT_CONFIRM'
  | 'MED_NAME'
  | 'MED_QTY'
  | 'MED_CONFIRM'
  | 'DOC_TYPE'
  | 'DOC_PATIENT'
  | 'DOC_ID'
  | 'DOC_PURPOSE'
  | 'DOC_CONFIRM'
  | 'HANDOFF';

export interface Session {
  phone: string;
  state: ChatState;
  data: Record<string, string>;
  fallbackCount: number;
  turns: number;
  createdAt: number;
  lastSeen: number;
  handoffReason?: string;
}

export type RequestKind = 'appointment' | 'medicine' | 'document' | 'prescription' | 'handoff';

export type RequestStatus = 'PENDING_STAFF' | 'CONTACTED' | 'COMPLETED' | 'CANCELLED';

export interface ServiceRequest {
  id: string;
  kind: RequestKind;
  phone: string;
  details: Record<string, string>;
  note?: string;
  status: RequestStatus;
  createdAt: number;
  updatedAt: number;
}

export interface IncomingMessage {
  from: string;
  text: string;
  id: string;
}

// ── Hospital stock (procurement) ─────────────────────────────────────────
// Separate from patient ServiceRequests: these are the hospital's own
// purchase requirements, not a patient enquiry.

export interface StockItem {
  name: string;
  quantity: string;
}

export type StockOrderStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';

export interface StockOrder {
  id: string;
  items: StockItem[];
  supplier?: string;
  urgency?: string;
  note?: string;
  requestedBy?: string;
  /** What the supplier actually said, recorded verbatim. Never generated. */
  supplierReply?: string;
  replyAt?: number;
  status: StockOrderStatus;
  createdAt: number;
  updatedAt: number;
}
