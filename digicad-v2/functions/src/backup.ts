import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { v1 } from '@google-cloud/firestore';
import { DEFAULT_LAB, REGION } from './util';

const BACKUP_BUCKET = defineString('BACKUP_BUCKET'); // ayrı, sürümlemeli, retention-lock'lu bucket adı (gs:// olmadan)
const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{2,221}$/;

export function backupPrefix(bucket: string, now = new Date()): string {
  if (!BUCKET_RE.test(bucket) || bucket.startsWith('gs://')) throw new Error('BACKUP_BUCKET geçersiz (gs:// olmadan, yalnızca bucket adı).');
  const stamp = now.toISOString().replace(/[:.]/g, '-'); // aynı gün tekrar çalışsa üzerine yazmaz
  return `gs://${bucket}/firestore/${stamp}`;
}

async function note(status: string, detail: Record<string, unknown>) {
  try {
    await getFirestore().collection(`labs/${DEFAULT_LAB}/auditLog`).add({ at: FieldValue.serverTimestamp(), actor: 'system', action: 'scheduledBackup', status, detail });
  } catch (e) { console.error('Yedek durumu auditLog\'a yazılamadı', (e as { code?: unknown })?.code); }
}

/** Her gün 03:15 (İstanbul) Firestore managed export. Sonucu bekler; hata loglanır (Cloud Logging uyarısı için) ve yeniden denenir. */
export const scheduledBackup = onSchedule({ schedule: '15 3 * * *', timeZone: 'Europe/Istanbul', region: REGION, timeoutSeconds: 540, retryCount: 2, maxInstances: 1 }, async () => {
  const client = new v1.FirestoreAdminClient();
  try {
    const project = await client.getProjectId();
    const prefix = backupPrefix(BACKUP_BUCKET.value());
    const [op] = await client.exportDocuments({ name: client.databasePath(project, '(default)'), outputUriPrefix: prefix, collectionIds: [] });
    console.log('Yedek başlatıldı:', op.name, prefix);
    await note('started', { prefix, operation: op.name });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), 500_000); });
    const res = await Promise.race([op.promise().then(() => 'done' as const), timeout]);
    if (timer) clearTimeout(timer);
    if (res === 'timeout') { console.warn('Yedek 500 sn içinde bitmedi; işlem arka planda sürüyor:', op.name); return; }
    console.log('Yedek tamamlandı:', prefix);
    await note('done', { prefix });
  } catch (e) {
    console.error('YEDEK BAŞARISIZ', e);
    await note('FAILED', { message: String((e as Error)?.message ?? e).slice(0, 500) });
    throw e; // retryCount ile yeniden dene + hata olarak raporlansın
  }
});
