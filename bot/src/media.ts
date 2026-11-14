import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

const GRAPH_URL = 'https://graph.facebook.com';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface SavedMedia {
  file?: string;
  note: string;
}

function mediaDir(): string {
  return process.env.PRESCRIPTIONS_DIR ?? path.join(process.cwd(), 'data', 'prescriptions');
}

/**
 * Downloads a WhatsApp media object to disk. In dry-run (or without a token)
 * nothing is fetched; the media id is recorded instead so the flow stays
 * testable offline.
 */
export async function saveMedia(
  mediaId: string,
  mimeType?: string,
  filename?: string,
): Promise<SavedMedia> {
  if (config.dryRun || !config.accessToken) {
    return { note: `dry-run: media ${mediaId} (${mimeType ?? 'unknown'}) not downloaded` };
  }

  const metaResponse = await fetch(`${GRAPH_URL}/${config.graphVersion}/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (!metaResponse.ok) {
    return { note: `could not resolve media ${mediaId}: HTTP ${metaResponse.status}` };
  }
  const meta = (await metaResponse.json()) as { url?: string; mime_type?: string };
  if (!meta.url) return { note: `media ${mediaId} had no download URL` };

  const fileResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (!fileResponse.ok) {
    return { note: `could not download media ${mediaId}: HTTP ${fileResponse.status}` };
  }

  const type = mimeType ?? meta.mime_type ?? '';
  const extension = EXTENSIONS[type] ?? path.extname(filename ?? '').replace('.', '') ?? 'bin';
  const safeFrom = filename ? path.basename(filename) : `${mediaId}.${extension || 'bin'}`;
  const target = path.join(mediaDir(), `${Date.now()}-${safeFrom}`);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await fileResponse.arrayBuffer()));
  return { file: target, note: `saved to ${target}` };
}
