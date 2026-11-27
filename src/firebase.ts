import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const ADMIN_EMAIL = 'abelminaya0@gmail.com';

export const DRIVE_SCOPES: string[] = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
];

const app = initializeApp(firebaseConfig);
const firestoreDatabaseId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
export const auth = getAuth(app);
auth.languageCode = 'es';
export const googleProvider = new GoogleAuthProvider();
DRIVE_SCOPES.forEach((scope) => googleProvider.addScope(scope));
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Strict in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedDriveAccessToken: string | null = null;
let cachedDriveEmail: string | null = null;
let isDriveSigningIn = false;

export const setDriveAccessToken = (token: string | null, email?: string | null) => {
  cachedDriveAccessToken = token || null;
  if (email !== undefined) {
    cachedDriveEmail = email || null;
  }
};

export const getDriveAccessToken = (): string | null => cachedDriveAccessToken;
export const getDriveCachedEmail = (): string | null => cachedDriveEmail;

export const clearDriveAccessToken = () => {
  cachedDriveAccessToken = null;
  cachedDriveEmail = null;
};

export const initDriveAuth = (
  onAuthSuccess?: (user: User | null, token: string, email: string | null) => void,
  onAuthFailure?: () => void
) => {
  let hadFirebaseUser = Boolean(auth.currentUser);
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      hadFirebaseUser = true;
      if (cachedDriveAccessToken) {
        onAuthSuccess?.(user, cachedDriveAccessToken, cachedDriveEmail || user.email || null);
      } else if (!isDriveSigningIn) {
        cachedDriveAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      if (hadFirebaseUser) {
        hadFirebaseUser = false;
        cachedDriveAccessToken = null;
        cachedDriveEmail = null;
        onAuthFailure?.();
      } else if (cachedDriveAccessToken) {
        onAuthSuccess?.(null, cachedDriveAccessToken, cachedDriveEmail);
      } else if (!isDriveSigningIn) {
        onAuthFailure?.();
      }
    }
  });
};

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GisClientError {
  type?: string;
  message?: string;
}

interface GisOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: GisTokenResponse) => void;
    error_callback?: (err: GisClientError) => void;
  }) => {
    requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
  };
}

function getGisOAuth2(): GisOAuth2 | null {
  return (
    (window as unknown as { google?: { accounts?: { oauth2?: GisOAuth2 } } })?.google?.accounts
      ?.oauth2 || null
  );
}

async function fetchDriveAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.user?.emailAddress === 'string' ? data.user.emailAddress : null;
  } catch {
    return null;
  }
}

function requestTokenWithGis(clientId: string): Promise<string> {
  const oauth2 = getGisOAuth2();
  if (!oauth2) {
    return Promise.reject(new Error('GIS_NOT_LOADED'));
  }

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPES.join(' '),
      callback: (resp) => {
        if (resp?.error) {
          reject(new Error(resp.error_description || resp.error));
          return;
        }
        if (!resp?.access_token) {
          reject(new Error('Google no devolvió el token de acceso para Drive.'));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        const type = err?.type || 'popup_error';
        if (type === 'popup_closed') {
          reject(Object.assign(new Error('popup_closed'), { code: 'auth/popup-closed-by-user' }));
        } else if (type === 'popup_failed_to_open') {
          reject(Object.assign(new Error('popup_failed_to_open'), { code: 'auth/popup-blocked' }));
        } else {
          reject(new Error(err?.message || `No se pudo abrir la ventana de Google (${type}).`));
        }
      },
    });

    client.requestAccessToken({ prompt: 'select_account' });
  });
}

export const signInGoogleForDrive = async (): Promise<{
  user: User | null;
  accessToken: string;
  email: string | null;
}> => {
  const oAuthClientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
  const oauth2 = getGisOAuth2();

  try {
    isDriveSigningIn = true;

    // 1. Prefer Google Identity Services with provisioned oAuthClientId synchronously on user click
    if (oAuthClientId && oauth2) {
      const accessToken = await requestTokenWithGis(oAuthClientId);
      cachedDriveAccessToken = accessToken;

      const [driveEmail] = await Promise.all([
        fetchDriveAccountEmail(accessToken),
        !auth.currentUser
          ? signInWithCredential(
              auth,
              GoogleAuthProvider.credential(null, accessToken)
            ).catch(() => null)
          : Promise.resolve(null),
      ]);

      const resolvedEmail = driveEmail || auth.currentUser?.email || null;
      cachedDriveEmail = resolvedEmail;
      return {
        user: auth.currentUser,
        accessToken,
        email: resolvedEmail,
      };
    }

    // 2. Fallback to Firebase Auth signInWithPopup
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('No se recibió el token de acceso de Google Drive.');
      }
      cachedDriveAccessToken = credential.accessToken;
      cachedDriveEmail = result.user.email || null;
      return {
        user: result.user,
        accessToken: cachedDriveAccessToken,
        email: cachedDriveEmail,
      };
    } catch (popupErr: unknown) {
      const code = String((popupErr as { code?: string })?.code || '');
      const isStandalone = (() => {
        try {
          return window.self === window.top;
        } catch {
          return false;
        }
      })();
      if (
        isStandalone &&
        (code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment')
      ) {
        await signInWithRedirect(auth, googleProvider);
      }
      throw popupErr;
    }
  } finally {
    isDriveSigningIn = false;
  }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
