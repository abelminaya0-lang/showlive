import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
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
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedDriveAccessToken) {
        onAuthSuccess?.(user, cachedDriveAccessToken, cachedDriveEmail || user.email || null);
      } else if (!isDriveSigningIn) {
        cachedDriveAccessToken = null;
        cachedDriveEmail = null;
        onAuthFailure?.();
      }
    } else if (!isDriveSigningIn) {
      cachedDriveAccessToken = null;
      cachedDriveEmail = null;
      onAuthFailure?.();
    }
  });
};

export const DRIVE_REDIRECT_UI_FLAG = 'showlive_drive_redirect';

export const signInGoogleForDrive = async (options?: {
  allowRedirectFallback?: boolean;
}): Promise<{
  user: User;
  accessToken: string;
  email: string | null;
}> => {
  const allowRedirectFallback = options?.allowRedirectFallback ?? true;

  try {
    isDriveSigningIn = true;

    let result;
    try {
      result = await signInWithPopup(auth, googleProvider);
    } catch (popupErr: unknown) {
      const code = String((popupErr as { code?: string })?.code || '');

      // If user is currently logged in with email/password and same email collides, link Google
      if (code === 'auth/account-exists-with-different-credential' && auth.currentUser) {
        result = await linkWithPopup(auth.currentUser, googleProvider);
      } else {
        const isStandalone = (() => {
          try {
            return window.self === window.top;
          } catch {
            return false;
          }
        })();

        if (
          allowRedirectFallback &&
          isStandalone &&
          (code === 'auth/popup-blocked' ||
            code === 'auth/operation-not-supported-in-this-environment')
        ) {
          try {
            sessionStorage.setItem(DRIVE_REDIRECT_UI_FLAG, '1');
          } catch {
            // Ignore storage errors
          }
          await signInWithRedirect(auth, googleProvider);
          throw Object.assign(new Error('Redirigiendo a Google...'), {
            code: 'auth/redirect-started',
          });
        }

        throw popupErr;
      }
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Google no devolvió el permiso de acceso para Google Drive. Vuelve a intentarlo aceptando los permisos.'
      );
    }

    cachedDriveAccessToken = credential.accessToken;
    cachedDriveEmail = result.user.email || null;
    return {
      user: result.user,
      accessToken: cachedDriveAccessToken,
      email: cachedDriveEmail,
    };
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
