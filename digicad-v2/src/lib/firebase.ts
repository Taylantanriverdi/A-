import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { initializeAuth, connectAuthEmulator, browserSessionPersistence, indexedDBLocalPersistence, browserLocalPersistence } from 'firebase/auth';
import {
  initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, terminate, clearIndexedDbPersistence,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

const env = import.meta.env;
const useEmu = env.VITE_USE_EMULATORS === 'true';
const fallback = document.getElementById('boot-fallback');
if (!env.VITE_FIREBASE_API_KEY && !useEmu) {
  // Yapılandırma yoksa beyaz ekran yerine açık bir uyarı göster ve dur.
  if (fallback) {
    const p = fallback.querySelector('p');
    if (p) p.textContent = 'Firebase ayarları eksik: program .env dosyasındaki VITE_FIREBASE_* değerleri girilerek derlenmelidir.';
  }
  throw new Error('Firebase yapılandırması (VITE_FIREBASE_*) eksik: derlemeyi .env ile yapın.');
}
fallback?.remove();

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
});

// App Check: Firestore/Storage/Functions'tan ÖNCE başlatılmalı. Üretimde anahtar yoksa sessizce geçilmez.
if (!useEmu) {
  if (env.VITE_RECAPTCHA_SITE_KEY) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } else if (env.PROD) {
    console.error('App Check devre dışı: VITE_RECAPTCHA_SITE_KEY tanımlı değil (sunucuda zorunlu kılınmışsa istekler reddedilir).');
  }
}

// Oturum: varsayılan olarak yalnızca sekme ömrü (paylaşımlı bilgisayarda sekme kapanınca oturum biter).
// VITE_AUTH_PERSISTENCE=local ile kalıcı oturum açılabilir.
export const auth = initializeAuth(app, {
  persistence: env.VITE_AUTH_PERSISTENCE === 'local' ? [indexedDBLocalPersistence, browserLocalPersistence] : [browserSessionPersistence],
});

// Firestore önbelleği: varsayılan BELLEK (tarayıcıya hasta verisi yazılmaz).
// VITE_OFFLINE_CACHE=true ile kalıcı (IndexedDB) önbellek açılır; çıkışta wipeLocalData() ile silinir.
export const persistentCache = env.VITE_OFFLINE_CACHE === 'true';
export const db = initializeFirestore(app, {
  localCache: persistentCache ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache(),
});
export const storage = getStorage(app);
export const functions = getFunctions(app, 'europe-west1');

/**
 * Cloud Functions çağrısı. Sunucu `consumeAppCheckToken` ile tek kullanımlık App Check token'ı ister (replay koruması),
 * bu yüzden istemci HER çağrıda `limitedUseAppCheckTokens` ile yeni token alır.
 */
export const callFn = <T = unknown>(name: string, data: unknown = {}): Promise<T> =>
  httpsCallable<unknown, T>(functions, name, { limitedUseAppCheckTokens: true })(data).then((r) => r.data);

if (useEmu) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

/** Çıkışta yerel veriyi bırakmamak için: dinleyicileri kapatır, varsa IndexedDB önbelleğini siler. */
export async function wipeLocalData(): Promise<void> {
  try { await terminate(db); } catch { /* zaten kapalı */ }
  if (persistentCache) { try { await clearIndexedDbPersistence(db); } catch { /* başka sekme açık olabilir */ } }
}
