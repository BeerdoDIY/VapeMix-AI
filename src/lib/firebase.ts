import { initializeApp, setLogLevel } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDocFromServer } from 'firebase/firestore';
import { getAnalytics, isSupported, logEvent as firebaseLogEvent } from 'firebase/analytics';
import firebaseConfig from '../../firebase-applet-config.json';
import ReactGA from 'react-ga4';

// Set Firebase log level to error to suppress "Could not reach Cloud Firestore backend" warnings
setLogLevel('error');

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
    if (error && error.message && (error.message.includes('the client is offline') || error.code === 'unavailable')) {
      console.warn("Firestore is operating in offline mode. Changes will be synced when connection is restored.");
    } else {
      console.error("Firebase configuration check:", error?.message || error);
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
      return null;
    }

    // We use a try-catch specifically for getAnalytics as it triggers background requests
    try {
      analyticsInstance = getAnalytics(app);
      return analyticsInstance;
    } catch (err: any) {
      // Catch specific 403/Permission Denied errors silently
      console.warn('Firebase Analytics initialization skipped:', err?.message || 'Permission Denied');
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
