import 'dotenv/config';

function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listEnv(name: string): string[] {
  return env(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  port: numberEnv('PORT', 3000),
  hospitalName: env('HOSPITAL_NAME', 'Rohan Thomas Hospital'),
  timezone: env('TZ', 'Asia/Kolkata'),

  // Meta Cloud API
  graphVersion: env('GRAPH_VERSION', 'v21.0'),
  phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
  accessToken: env('WHATSAPP_ACCESS_TOKEN'),
  appSecret: env('WHATSAPP_APP_SECRET'),
  verifyToken: env('WHATSAPP_VERIFY_TOKEN', 'dev-verify-token'),

  // Staff handoff
  staffNumbers: listEnv('STAFF_WHATSAPP_NUMBERS'),
  staffInboxWebhook: env('STAFF_INBOX_WEBHOOK'),
  handoffPauseMinutes: numberEnv('HANDOFF_PAUSE_MINUTES', 120),

  // Admin API
  adminKey: env('ADMIN_KEY'),

  // Procurement
  stockSupplier: env('STOCK_SUPPLIER', 'Leo Pharma, Thrissur'),

  // Dev
  dryRun: env('BOT_DRY_RUN', 'false').toLowerCase() === 'true',
};

export function assertProductionConfig(): void {
  if (config.dryRun) return;
  const missing: string[] = [];
  if (!config.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!config.accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')}. Set BOT_DRY_RUN=true to run without Meta credentials.`,
    );
  }
}
