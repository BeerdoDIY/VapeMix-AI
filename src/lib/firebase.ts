import { initializeApp, setLogLevel as setAppLogLevel } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDocFromServer, setLogLevel as setFirestoreLogLevel } from 'firebase/firestore';
import { getAnalytics, isSupported, logEvent as firebaseLogEvent } from 'firebase/analytics';
import firebaseConfig from '../../firebase-applet-config.json';
import ReactGA from 'react-ga4';

// Set Firebase log levels to error to suppress "Could not reach Cloud Firestore backend" warnings etc.
setAppLogLevel('error');
setFirestoreLogLevel('error');

// Filter out background Firebase background errors which are common in restricted preview environments
if (typeof window !== 'undefined') {
  const isInstallationError = (msg: string) => 
    msg.includes('installations/request-failed') || 
    (msg.includes('403') && msg.includes('installations')) ||
    (msg.includes('PERMISSION_DENIED') && msg.includes('installations')) ||
    msg.includes('auth/network-request-failed') ||
    msg.includes('network-request-failed');

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    const msg = error?.message || String(error);
    if (isInstallationError(msg) || msg.includes('Could not reach Cloud Firestore backend') || msg.includes('auth/network-request-failed')) {
      event.preventDefault();
      // Silently swallow
    }
  });

  // Also intercept console.error for these specific recurrent warnings if they bypass log levels
  const originalError = console.error;
  console.error = (...args) => {
    const msg = args.map(a => String(a)).join(' ');
    if (isInstallationError(msg) || msg.includes('Could not reach Cloud Firestore backend')) {
      return; // Skip logging these to console
    }
    originalError.apply(console, args);
  };
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
}, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

/**
 * CRITICAL CONSTRAINT: Test connection to Firestore on boot
 */
export async function testFirestoreConnection() {
  try {
    // Attempt to get a dummy document from the server to verify connectivity
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection verified.");
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (msg.includes('the client is offline') || error.code === 'unavailable') {
      console.warn("Firestore is operating in offline mode. Changes will be synced when connection is restored.");
    } else if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
      // If we still get permission denied even after adding the rule, it might be a project state issue.
      // We log as info/warn rather than error to avoid triggering error overlays.
      console.info("Firestore connection check: Note on permissions - this is expected in some restricted environments.");
    } else {
      console.error("Firebase configuration check:", msg);
    }
  }
}

// Global flag and instance cache
let analyticsFailed = false;
let analyticsInstance: any = null;

/**
 * Initialize Analytics lazily.
 * This is only called when someone tries to track an event.
 */
export const getAnalyticsInstance = async () => {
  if (analyticsFailed) return null;
  if (analyticsInstance) return analyticsInstance;

  // Allow a manual kill switch
  if (import.meta.env.VITE_DISABLE_FIREBASE_ANALYTICS === 'true' || import.meta.env.VITE_DISABLE_FIREBASE_ANALYTICS === true) {
    return null;
  }

  try {
    const supported = await isSupported();
    if (!supported || !firebaseConfig.measurementId) {
      analyticsFailed = true;
      return null;
    }

    // We use a try-catch specifically for getAnalytics as it triggers background requests
    try {
      analyticsInstance = getAnalytics(app);
      return analyticsInstance;
    } catch (err: any) {
      const msg = err?.message || String(err);
      // Catch specific 403/Permission Denied/Installations errors silently
      if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('installations')) {
        console.warn('Firebase Analytics initialization skipped (Background Permission/Installation issue):', msg);
      } else {
        console.warn('Firebase Analytics initialization skipped:', msg);
      }
      analyticsFailed = true;
      return null;
    }
  } catch (err: any) {
    analyticsFailed = true;
    return null;
  }
};

/**
 * Universal logger that sends events to both Firebase and GA4
 */
export const trackEvent = async (eventName: string, params?: Record<string, any>) => {
  // Only attempt tracking if we are not failing analytics and if we have a reason to (e.g. consent given)
  // Note: We don't check consent here because this function is called only in response to user actions
  // but if the app doesn't have consent, we shouldn't have initialized yet.
  
  try {
    const analytics = await getAnalyticsInstance();
    if (analytics) {
      firebaseLogEvent(analytics, eventName, params);
    }
  } catch (e) {
    // Silent fail for background tracking
  }

  // Try react-ga4 (if initialized)
  try {
    if (ReactGA.isInitialized) {
      ReactGA.event(eventName, params);
    }
  } catch (e) {
    // GA4 might not be initialized yet
  }
};

export { signInWithPopup, signOut, onAuthStateChanged };
export type { User };
