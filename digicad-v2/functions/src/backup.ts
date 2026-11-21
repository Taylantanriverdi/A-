import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString } from 'firebase-functions/params';
import { v1 } from '@google-cloud/firestore';

const BACKUP_BUCKET = defineString('BACKUP_BUCKET'); // ayrı, sürümlemeli, retention-lock'lu bucket adı (gs:// olmadan)

/** Her gün 03:15 (İstanbul) Firestore managed export. */
export const scheduledBackup = onSchedule({ schedule: '15 3 * * *', timeZone: 'Europe/Istanbul', region: 'europe-west1' }, async () => {
  const client = new v1.FirestoreAdminClient();
  const project = process.env.GCLOUD_PROJECT as string;
  const stamp = new Date().toISOString().slice(0, 10);
  const [op] = await client.exportDocuments({
    name: client.databasePath(project, '(default)'),
    outputUriPrefix: `gs://${BACKUP_BUCKET.value()}/firestore/${stamp}`,
    collectionIds: [],
  });
  console.log('Yedek başlatıldı:', op.name);
});
