import * as React from 'react';
import { useState, useEffect, useMemo, ReactNode, useCallback, useRef } from 'react';
import { 
  Plus, 
  Search, 
  FlaskConical, 
  Book, 
  Sparkles, 
  Settings, 
  Trash2, 
  Edit2, 
  ChevronRight,
  ShieldCheck,
  Droplets,
  Beaker,
  Zap,
  Scale,
  DollarSign,
  Save,
  PlusCircle,
  X,
  RefreshCw,
  Check,
  Mail,
  ArrowUpDown,
  Filter,
  ShoppingCart,
  Star,
  Download,
  Upload,
  Copy,
  FileText,
  File as FileIcon,
  LogOut,
  LogIn,
  User as UserIcon,
  Cloud,
  CloudOff,
  AlertCircle,
  AlertTriangle,
  Moon,
  Sun,
  Heart,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  History,
  Package,
  StickyNote,
  Info,
  FileDown
} from 'lucide-react';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'motion/react';
import ReactGA from 'react-ga4';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Recipe, Flavor, IngredientCost, UserSettings, CalculationResult, InventoryFlavor, ShoppingItem, Mix, Order } from './types';
import { calculateRecipe } from './lib/calculations';
import { suggestRecipes, parseImportedRecipe, parseInvoice } from './services/geminiService';
import { getSafetyWarnings, formatSafetyWarnings, getPotencyWarning } from './lib/safety';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User,
  trackEvent,
  testFirestoreConnection
} from './lib/firebase';
import { flavor, flavors, flavoring } from './lib/localization';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  getDocs, 
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.warn('Firestore Operation Status: ', JSON.stringify(errInfo));
  
  // Suppress errors that are expected when offline or transient
  const isOfflineError = 
    errInfo.error.includes('timed out') || 
    errInfo.error.includes('offline') || 
    errInfo.error.includes('network error') ||
    errInfo.error.includes('Failed to get document because the client is offline') ||
    errInfo.error.includes('unavailable') ||
    errInfo.error.includes('Cloud operation timed out');

  if (isOfflineError) return;
  
  throw new Error(JSON.stringify(errInfo));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error('Cloud operation timed out. Please check your connection.')), timeoutMs)
    )
  ]);
}

function sanitizeForFirestore(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(v => sanitizeForFirestore(v));
  } else if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, sanitizeForFirestore(v)])
    );
  }
  return obj;
}

function isFlavorMatch(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  
  const getTokens = (s: string) => {
    let res = s.toLowerCase().trim();
    
    // Expand common abbreviations/names
    const expansions: Record<string, string> = {
      'the flavor apprentice': 'tpa',
      'the flavours apprentice': 'tpa',
      'tfa': 'tpa',
      'capella flavors': 'cap',
      'capella': 'cap',
      'flavourart': 'fa',
      'flavour art': 'fa',
      'flavor west': 'fw',
      'flavorwest': 'fw',
      'inawera': 'inw',
      'lorann oils': 'la',
      'lorann': 'la',
      'jungle flavors': 'jf',
      'vape train australia': 'vt',
      'vape train': 'vt',
      'flavorah': 'flv',
      'sobucky super aroma': 'ssa',
      'sobucky': 'ssa',
      'wonder flavours': 'wf'
    };

    Object.entries(expansions).forEach(([full, short]) => {
      // Use regex to replace full names with short codes, ensuring boundary checks
      const escaped = full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      res = res.replace(new RegExp(`\\b${escaped}\\b`, 'g'), short);
    });

    // Remove punctuation and split into tokens
    return res.replace(/[^a-z0-9 ]/g, ' ')
              .split(/\s+/)
              .filter(Boolean)
              .sort();
  };

  const tokens1 = getTokens(name1);
  const tokens2 = getTokens(name2);

  // Exact set of tokens match (e.g. "CAP Super Sweet" vs "Super Sweet (CAP)")
  if (tokens1.join('') === tokens2.join('')) return true;

  // Partial match: if one's tokens are a subset of the other's, AND the shared tokens 
  // contain a known manufacturer, they are likely the same.
  // Actually, let's keep it simple: if they match without manufacturer tokens, they are likely the same flavor.
  const manufacturers = ['tpa', 'tfa', 'cap', 'fa', 'fw', 'inw', 'la', 'jf', 'vt', 'flv', 'ssa', 'wf'];
  const base1 = tokens1.filter(t => !manufacturers.includes(t)).join('');
  const base2 = tokens2.filter(t => !manufacturers.includes(t)).join('');
  
  const man1 = tokens1.find(t => manufacturers.includes(t));
  const man2 = tokens2.find(t => manufacturers.includes(t));

  // If both have the same base name AND (same manufacturer or one is missing)
  if (base1.length > 2 && base1 === base2) {
    if (!man1 || !man2 || man1 === man2) return true;
  }

  return false;
}

function getManufacturer(name: string): string {
  const lastParenIndex = name.lastIndexOf('(');
  if (lastParenIndex !== -1) {
    const man = name.substring(lastParenIndex + 1).replace(')', '').trim();
    return man.toUpperCase();
  }
  return 'OTHER';
}

function formatFlavorName(name: string): string {
  const lastParenIndex = name.lastIndexOf('(');
  if (lastParenIndex !== -1) {
    return name.substring(0, lastParenIndex).trim();
  }
  return name;
}

interface Substitution {
  flavor: InventoryFlavor;
  multiplier: number;
}

function findSubstitutes(flavorName: string, inventory: InventoryFlavor[]): Substitution[] {
  if (!flavorName) return [];
  
  const normalize = (name: string) => {
    let base = name;
    const lastParenIndex = name.lastIndexOf('(');
    if (lastParenIndex !== -1) {
      base = name.substring(0, lastParenIndex).trim();
    }
    return base.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  };

  const targetBase = normalize(flavorName);
  const targetWords = targetBase.split(/\s+/).filter(w => w.length > 1);
  
  const families: Record<string, { words: string[], potency: number }> = {
    'strawberry ripe': { words: ['strawberry', 'ripe'], potency: 0.8 },
    'strawberry shisha': { words: ['strawberry', 'shisha'], potency: 1.2 },
    'sweet strawberry': { words: ['strawberry', 'sweet'], potency: 1.0 },
    'strawberry': { words: ['strawberry'], potency: 1.0 },
    'ws-23': { words: ['ws', '23'], potency: 1.5 },
    'koolada': { words: ['koolada'], potency: 1.0 },
    'menthol': { words: ['menthol'], potency: 2.0 },
    'vanilla custard': { words: ['vanilla', 'custard'], potency: 1.0 },
    'vanilla bean ice cream': { words: ['vanilla', 'bean', 'ice', 'cream'], potency: 0.9 },
    'vbic': { words: ['vbic'], potency: 0.9 },
    'super sweet': { words: ['super', 'sweet'], potency: 2.0 },
    'sweetener': { words: ['sweetener'], potency: 1.0 },
  };

  const suggestions = inventory.filter(inv => {
    const invName = inv.name.toLowerCase();
    const targetName = flavorName.toLowerCase();
    if (invName === targetName) return false;
    
    const invBase = normalize(inv.name);
    if (invBase === targetBase) return true;
    if (invBase.includes(targetBase) || targetBase.includes(invBase)) return true;
    
    const invWords = invBase.split(/\s+/).filter(w => w.length > 1);
    const commonWords = invWords.filter(w => targetWords.includes(w));
    
    // Match if significant word overlap
    if (commonWords.length >= 2) return true;
    if (commonWords.length === 1 && (commonWords[0].length > 5 || targetWords.length === 1)) return true;

    return false;
  }).map(inv => {
    const invBase = normalize(inv.name);
    let multiplier = 1.0;
    
    let bestInvFamily: string | null = null;
    let invMaxOverlap = 0;
    Object.entries(families).forEach(([family, data]) => {
      const overlap = data.words.filter(w => invBase.includes(w)).length;
      if (overlap > invMaxOverlap) {
        invMaxOverlap = overlap;
        bestInvFamily = family;
      }
    });

    let bestTargetFamily: string | null = null;
    let targetMaxOverlap = 0;
    Object.entries(families).forEach(([family, data]) => {
      const overlap = data.words.filter(w => targetBase.includes(w)).length;
      if (overlap > targetMaxOverlap) {
        targetMaxOverlap = overlap;
        bestTargetFamily = family;
      }
    });

    if (bestInvFamily && bestTargetFamily && bestInvFamily !== bestTargetFamily) {
      const targetPotency = families[bestTargetFamily].potency;
      const invPotency = families[bestInvFamily].potency;
      multiplier = targetPotency / invPotency;
    }

    return {
      flavor: inv,
      multiplier: Number(multiplier.toFixed(2))
    };
  });

  // Deduplicate suggestions by flavor name to prevent repeats in UI
  const uniqueResults: Substitution[] = [];
  const seenNames = new Set<string>();
  
  for (const sub of suggestions) {
    if (!seenNames.has(sub.flavor.name)) {
      seenNames.add(sub.flavor.name);
      uniqueResults.push(sub);
    }
    if (uniqueResults.length >= 5) break;
  }
  
  return uniqueResults;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const self = this as any;
    if (self.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(self.state.error.message);
        if (parsed.error) errorMessage = `Firestore Error: ${parsed.error} (${parsed.operationType} on ${parsed.path})`;
      } catch (e) {
        errorMessage = self.state.error.message || String(self.state.error);
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
          <Card className="max-w-md w-full border-red-100">
            <CardHeader className="text-center">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <CardTitle>Application Error</CardTitle>
              <CardDescription>
                {errorMessage}
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex justify-center">
              <Button onClick={() => window.location.reload()}>Reload Application</Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return self.props.children;
  }
}

const DEFAULT_COSTS: IngredientCost = {
  nicCostPerMl: 0.066,
  pgCostPerMl: 0.027,
  vgCostPerMl: 0.01,
  bottleCost: 0.57
};

const CATEGORIES = ['Fruit', 'Tobacco', 'Dessert', 'Candy', 'Custard', 'Ice', 'Beverage', 'Bakery', 'Other'];

const RECIPE_SORT_OPTIONS: Record<string, string> = {
  newest: 'Newest',
  name: 'Name',
  rating: 'Rating',
  lastMixed: 'Last Mixed',
  mostMixed: 'Most Mixed'
};

const INVENTORY_SORT_OPTIONS: Record<string, string> = {
  name: 'Alphabetical',
  manufacturer: 'Manufacturer'
};

const SOURCE_OPTIONS: Record<string, string> = {
  manual: 'Manual',
  import: 'Imported',
  ai: 'AI Generated'
};

const MIXING_PREFERENCE_OPTIONS: Record<string, string> = {
  weight: 'By Weight (Grams)',
  volume: 'By Volume (Milliliters)'
};

const THEME_OPTIONS: Record<string, string> = {
  light: 'Light Mode',
  dark: 'Dark Mode',
  system: 'System (Auto)'
};

function checkDuplicateRecipe(newRecipe: Partial<Recipe>, existingRecipes: Recipe[]) {
  return existingRecipes.find(r => {
    // Check name (case insensitive)
    const nameMatch = r.name.toLowerCase() === newRecipe.name?.toLowerCase();
    
    // Check flavors (names and percentages)
    const flavorsMatch = r.flavors.length === newRecipe.flavors?.length &&
      r.flavors.every(f => 
        newRecipe.flavors?.some(nf => 
          nf.name.toLowerCase() === f.name.toLowerCase() && 
          nf.percentage === f.percentage
        )
      );
    
    return (nameMatch || flavorsMatch) && r.id !== newRecipe.id;
  });
}

function getNextVersionName(name: string, recipes: Recipe[]) {
  let baseName = name;
  let version = 1;

  const versionMatch = name.match(/(.*) v(\d+)$/);
  if (versionMatch) {
    baseName = versionMatch[1];
    version = parseInt(versionMatch[2]);
  }

  const baseNameLower = baseName.toLowerCase();
  let maxVersion = version;
  
  recipes.forEach(r => {
    const m = r.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} v(\\d+)$`, 'i'));
    if (m) {
      const v = parseInt(m[1]);
      if (v > maxVersion) maxVersion = v;
    } else if (r.name.toLowerCase() === baseNameLower) {
      if (1 > maxVersion) maxVersion = 1;
    }
  });

  return `${baseName} v${maxVersion + 1}`;
}

function getNextInventoryName(name: string, inventory: InventoryFlavor[]) {
  let baseName = name;
  const match = name.match(/(.*) \((\d+)\)$/);
  if (match) {
    baseName = match[1];
  }

  let maxNum = 1;
  const regex = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\((\\d+)\\)$`, 'i');
  
  inventory.forEach(item => {
    if (item.name.toLowerCase() === baseName.toLowerCase()) {
      if (1 > maxNum) maxNum = 1;
    }
    const m = item.name.match(regex);
    if (m) {
      const num = parseInt(m[1]);
      if (num > maxNum) maxNum = num;
    }
  });

  return `${baseName} (${maxNum + 1})`;
}

const INITIAL_RECIPES: Recipe[] = [];

const INITIAL_INVENTORY: string[] = [];

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-recipes-v2') : null;
    return saved ? JSON.parse(saved) : INITIAL_RECIPES;
  });
  const [inventory, setInventory] = useState<InventoryFlavor[]>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-inventory-v2') : null;
    if (!saved) return INITIAL_INVENTORY.map(name => ({ name }));
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed.map((name: string) => ({ name })) : parsed;
  });
  const [costs, setCosts] = useState<IngredientCost>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-costs') : null;
    return saved ? JSON.parse(saved) : DEFAULT_COSTS;
  });
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-user-settings') : null;
    const defaultSettings: UserSettings = {
      defaultNicBaseMg: 100,
      defaultNicBaseType: 'PG',
      defaultTargetPgRatio: 50,
      defaultServingMl: 120,
      defaultTargetNicMg: 3,
      mixingPreference: 'weight',
      lowStockThreshold: 10,
      pgDensity: 1.038,
      vgDensity: 1.26,
      aiCustomInstructions: '',
      theme: 'light',
      acknowledgedSafety: false
    };
    
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultSettings, ...parsed };
    }
    return defaultSettings;
  });
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-shopping-list') : null;
    return saved ? JSON.parse(saved) : [];
  });
  const [mixes, setMixes] = useState<Mix[]>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-mixes') : null;
    return saved ? JSON.parse(saved) : [];
  });
  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-orders') : null;
    return saved ? JSON.parse(saved) : [];
  });
  const [activeTab, setActiveTab] = useState('recipes');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryFlavor | null>(null);
  const [initialFocusField, setInitialFocusField] = useState<string | null>(null);
  const [pendingAddTarget, setPendingAddTarget] = useState<'stash' | 'shopping' | null>(null);
  const [duplicateFound, setDuplicateFound] = useState<Recipe | null>(null);
  const [pendingRecipe, setPendingRecipe] = useState<Recipe | null>(null);
  const [pendingMix, setPendingMix] = useState<Mix | null>(null);
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  const startEditing = (item: InventoryFlavor, target?: 'stash' | 'shopping', focusField?: string) => {
    setPendingAddTarget(target || null);
    setInitialFocusField(focusField || null);
    setEditingItem(item);
  };
  const [recipeToDelete, setRecipeToDelete] = useState<Recipe | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isInvoiceImporting, setIsInvoiceImporting] = useState(false);
  const [isStashImporting, setIsStashImporting] = useState(false);

  const handleImportStash = (importedItems: InventoryFlavor[]) => {
    // Merge logic: Add new items, skip existing
    let addedCount = 0;
    importedItems.forEach(item => {
      if (!inventory.some(inv => isFlavorMatch(inv.name, item.name))) {
        internalAddInventoryItem(item);
        addedCount++;
      }
    });
    return addedCount;
  };
  const [missingFlavorsToShop, setMissingFlavorsToShop] = useState<string[]>([]);
  const [duplicateInventoryFound, setDuplicateInventoryFound] = useState<InventoryFlavor | null>(null);
  const [pendingInventoryItem, setPendingInventoryItem] = useState<InventoryFlavor | null>(null);
  const [pendingInvoiceItems, setPendingInvoiceItems] = useState<InventoryFlavor[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showSafetyDisclaimer, setShowSafetyDisclaimer] = useState(false);
  const [isViewingSafety, setIsViewingSafety] = useState(false);
  const [cookieConsent, setCookieConsent] = useState<boolean | null>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('vape-cookie-consent') : null;
    return saved ? JSON.parse(saved) : null;
  });
  const [runtimeKey, setRuntimeKey] = useState<string | null>(null);
  const [hasAiStudio, setHasAiStudio] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Initialize GA4
  useEffect(() => {
    const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
    if (measurementId && cookieConsent === true) {
      ReactGA.initialize(measurementId);
      ReactGA.send({ hitType: "pageview", page: window.location.pathname });
      trackEvent('page_view', { page_path: window.location.pathname });
    }
  }, [cookieConsent]);

  // Track Tab Changes
  useEffect(() => {
    if (cookieConsent === true) {
      const pagePath = `/${activeTab}`;
      if (ReactGA.isInitialized) {
        ReactGA.send({ hitType: "pageview", page: pagePath, title: activeTab });
      }
      trackEvent('page_view', { page_path: pagePath, page_title: activeTab });
    }
  }, [activeTab, cookieConsent]);

  // Version
  const VERSION = "1.26.9";

  // History Navigation Support
  useEffect(() => {
    // Initial state
    if (window.history.state === null) {
      window.history.replaceState({ tab: activeTab, isRecipeOpen: !!editingRecipe, isFlavorOpen: !!editingItem }, "");
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state) {
        if (state.tab && state.tab !== activeTab) {
          setActiveTab(state.tab);
        }
        
        // Close modals if history goes back
        if (!state.isRecipeOpen && editingRecipe) {
          setEditingRecipe(null);
        }
        if (!state.isFlavorOpen && editingItem) {
          setEditingItem(null);
        }
        if (!state.isInvoiceImporting && isInvoiceImporting) {
          setIsInvoiceImporting(false);
        }
        if (!state.isStashImporting && isStashImporting) {
          setIsStashImporting(false);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, editingRecipe, editingItem, isInvoiceImporting, isStashImporting]);

  // Push history state when navigation occurs
  useEffect(() => {
    const currentState = { 
      tab: activeTab, 
      isRecipeOpen: !!editingRecipe, 
      isFlavorOpen: !!editingItem,
      isInvoiceImporting,
      isStashImporting
    };
    
    const lastState = window.history.state;
    
    // Only push if something meaningful changed and it's not a redundant state
    // We check if the current browser history state matches the app state.
    // If they differ, it means the state change came from a user action in the UI, not from the back button.
    if (!lastState || 
        lastState.tab !== currentState.tab || 
        lastState.isRecipeOpen !== currentState.isRecipeOpen ||
        lastState.isFlavorOpen !== currentState.isFlavorOpen ||
        lastState.isInvoiceImporting !== currentState.isInvoiceImporting ||
        lastState.isStashImporting !== currentState.isStashImporting
    ) {
      window.history.pushState(currentState, "");
    }
  }, [activeTab, editingRecipe, editingItem, isInvoiceImporting, isStashImporting]);

  // Scroll to top on tab change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);

  // Safety Disclaimer logic
  useEffect(() => {
    // Wait for auth to be determined and app loading to finish to avoid flashes
    if (isAuthReady && !isAppLoading && userSettings.acknowledgedSafety === false) {
      setShowSafetyDisclaimer(true);
    }
  }, [isAuthReady, isAppLoading, userSettings.acknowledgedSafety]);

  // Theme Management
  useEffect(() => {
    const root = window.document.documentElement;
    const theme = userSettings.theme || 'light';
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.toggle('dark', systemTheme === 'dark');
      
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        root.classList.toggle('dark', e.matches);
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      root.classList.toggle('dark', theme === 'dark');
    }
  }, [userSettings.theme]);

  // Connection monitoring
  useEffect(() => {
    testFirestoreConnection();
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    // Suppress Firebase Installation 403 errors globally to prevent annoying popups/crashes
    const handleGlobalError = (event: PromiseRejectionEvent | ErrorEvent) => {
      let msg = "";
      let error: any = null;
      if (event instanceof PromiseRejectionEvent) {
        msg = event.reason?.message || (typeof event.reason === 'string' ? event.reason : "");
        error = event.reason;
      } else {
        msg = (event as ErrorEvent).message || "";
        error = (event as ErrorEvent).error;
      }

      const lowerMsg = msg.toLowerCase();
      const isFirebaseError = 
        lowerMsg.includes("403") || 
        lowerMsg.includes("permission_denied") || 
        lowerMsg.includes("permission denied") ||
        lowerMsg.includes("installations") ||
        lowerMsg.includes("analytics") ||
        lowerMsg.includes("firebaseerror") ||
        lowerMsg.includes("unavailable") ||
        lowerMsg.includes("could not reach cloud firestore") ||
        lowerMsg.includes("storage/unauthorized") ||
        lowerMsg.includes("request-failed") ||
        (error && error.code && (
          error.code.includes('permission-denied') || 
          error.code.includes('unavailable') || 
          error.code === 'installations/request-failed'
        ));

      if (isFirebaseError) {
        // Log it as a warning instead of a full error if it's just expected connectivity issue
        if (lowerMsg.includes("unavailable") || lowerMsg.includes("could not reach cloud firestore")) {
          console.warn("Firebase Connectivity: Backend momentarily unreachable. Working offline.");
        } else {
          console.warn("Firebase background error suppressed:", msg);
        }

        if (event instanceof ErrorEvent || event instanceof PromiseRejectionEvent) {
          event.preventDefault();
        }
        if (event && typeof (event as any).stopPropagation === 'function') {
          (event as any).stopPropagation();
        }
        return true;
      }
    };

    window.addEventListener('unhandledrejection', handleGlobalError);
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('unhandledrejection', handleGlobalError);
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Proactive sync when user logs in
  useEffect(() => {
    if (user && isAuthReady) {
      // Trigger sync if we have ANY data that might not be in the cloud
      // Being a bit more aggressive here to ensure data consistency
      const hasPotentiallyUnsyncedData = recipes.length > 0 || inventory.length > 0 || orders.length > 0 || shoppingList.length > 0;
      
      if (hasPotentiallyUnsyncedData) {
        console.log("User logged in with data, performing initial sync check...");
        syncLocalToCloud();
      }
    }
  }, [user, isAuthReady]); // Only on mount/login, don't loop on data changes

  useEffect(() => {
    if (isAuthReady) {
      localStorage.setItem('vape-orders', JSON.stringify(orders));
    }
  }, [orders, isAuthReady]);

  // Initial loading
  useEffect(() => {
    const timer = setTimeout(() => setIsAppLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Check for AI Studio API Key
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        setHasAiStudio(true);
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (hasKey) {
          // In a real app we'd get the key, here we just mark it as connected
          setRuntimeKey('AI_STUDIO_KEY');
        }
      }
      
      const manual = userSettings.geminiApiKey || localStorage.getItem('manual_gemini_api_key');
      if (manual) setRuntimeKey(manual);
    };
    checkKey();
  }, [userSettings.geminiApiKey]);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (hasKey) setRuntimeKey('AI_STUDIO_KEY');
    }
  };

  const prevUidRef = useRef<string | null>(null);

  const resetState = useCallback(() => {
    setRecipes(INITIAL_RECIPES);
    setInventory(INITIAL_INVENTORY.map(name => ({ name })));
    setShoppingList([]);
    setMixes([]);
    setOrders([]);
    setUserSettings({
      geminiApiKey: '',
      defaultNicBaseMg: 100,
      defaultNicBaseType: 'PG',
      defaultTargetPgRatio: 50,
      defaultServingMl: 120,
      defaultTargetNicMg: 3,
      mixingPreference: 'weight',
      lowStockThreshold: 10,
      pgDensity: 1.038,
      vgDensity: 1.26,
      theme: 'light',
      acknowledgedSafety: false
    });
    setCosts(DEFAULT_COSTS);
    
    // Clear localStorage
    const keysToClear = [
      'vape-recipes-v2',
      'vape-inventory-v2',
      'vape-shopping-list',
      'vape-user-settings',
      'vape-costs',
      'vape-mixes',
      'vape-orders'
    ];
    keysToClear.forEach(key => localStorage.removeItem(key));
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      const prevUid = prevUidRef.current;
      const currentUid = currentUser?.uid || null;

      // If user changed (and it's not the initial load where both are null)
      if (prevUid !== currentUid && isAuthReady) {
        // If we were logged in and now we are someone else or guest, clear state
        if (prevUid !== null) {
          console.log("User changed or logged out, resetting local state.");
          resetState();
        }
      }
      
      prevUidRef.current = currentUid;
      setUser(currentUser);
      setIsAuthReady(true);

      // Improve tracking accuracy with GA4 User-ID stitching
      const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
      if (measurementId && cookieConsent === true) {
        if (currentUser) {
          // Set user_id for cross-device/cross-session stitching
          ReactGA.set({ userId: currentUser.uid });
        } else {
          // Reset when logged out
          ReactGA.set({ userId: undefined });
        }
      }
    });
    return () => unsubscribe();
  }, [isAuthReady, resetState, cookieConsent]);

  // Persistence for all users (caching)
  useEffect(() => {
    if (isAuthReady) {
      localStorage.setItem('vape-recipes-v2', JSON.stringify(recipes));
    }
  }, [recipes, isAuthReady]);

  useEffect(() => {
    if (isAuthReady) {
      localStorage.setItem('vape-inventory-v2', JSON.stringify(inventory));
    }
  }, [inventory, isAuthReady]);

  useEffect(() => {
    if (isAuthReady) {
      localStorage.setItem('vape-shopping-list', JSON.stringify(shoppingList));
    }
  }, [shoppingList, isAuthReady]);

  useEffect(() => {
    if (isAuthReady) {
      localStorage.setItem('vape-user-settings', JSON.stringify(userSettings));
    }
  }, [userSettings, isAuthReady]);

  useEffect(() => {
    if (isAuthReady) {
      localStorage.setItem('vape-costs', JSON.stringify(costs));
    }
  }, [costs, isAuthReady]);

  useEffect(() => {
    if (isAuthReady) {
      localStorage.setItem('vape-mixes', JSON.stringify(mixes));
    }
  }, [mixes, isAuthReady]);

  // Firestore Syncing
  useEffect(() => {
    if (!isAuthReady) return;

    if (!user) {
      // Data is already loaded from local storage in useState initializers
      return;
    }

    // Real-time Firestore Listeners
    setIsSyncing(true);
    const uid = user.uid;

    const unsubRecipes = onSnapshot(collection(db, 'users', uid, 'recipes'), (snapshot) => {
      setRecipes(snapshot.docs.map(doc => doc.data() as Recipe));
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/recipes`));

    const unsubInventory = onSnapshot(collection(db, 'users', uid, 'inventory'), (snapshot) => {
      setInventory(snapshot.docs.map(doc => doc.data() as InventoryFlavor));
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/inventory`));

    const unsubShopping = onSnapshot(collection(db, 'users', uid, 'shoppingList'), (snapshot) => {
      setShoppingList(snapshot.docs.map(doc => doc.data() as ShoppingItem));
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/shoppingList`));

    const unsubSettings = onSnapshot(doc(db, 'users', uid, 'settings', 'user_settings'), (docSnap) => {
      if (docSnap.exists()) {
        const cloudSettings = docSnap.data() as UserSettings;
        setUserSettings(prev => ({ 
          ...prev, 
          ...cloudSettings,
          // Ensure acknowledgedSafety is explicitly boolean even if missing in cloud
          acknowledgedSafety: cloudSettings.acknowledgedSafety ?? prev.acknowledgedSafety ?? false
        }));
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/settings/user_settings`));

    const unsubCosts = onSnapshot(doc(db, 'users', uid, 'settings', 'costs'), (docSnap) => {
      if (docSnap.exists()) setCosts(docSnap.data() as IngredientCost);
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/settings/costs`));

    const unsubMixes = onSnapshot(collection(db, 'users', uid, 'mixes'), (snapshot) => {
      setMixes(snapshot.docs.map(doc => doc.data() as Mix));
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/mixes`));

    const unsubOrders = onSnapshot(collection(db, 'users', uid, 'orders'), (snapshot) => {
      const cloudOrders = snapshot.docs.map(doc => doc.data() as Order);
      setOrders(prev => {
        // Merge strategy: Keep local orders that aren't in the cloud yet
        // This prevents data loss if a local write hasn't succeeded yet
        const cloudIds = new Set(cloudOrders.map(o => o.id));
        const localOnly = prev.filter(o => !cloudIds.has(o.id) && (o.uid === 'anonymous' || o.uid === uid));
        return [...cloudOrders, ...localOnly];
      });
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/orders`));

    setIsSyncing(false);

    return () => {
      unsubRecipes();
      unsubInventory();
      unsubShopping();
      unsubSettings();
      unsubCosts();
      unsubMixes();
      unsubOrders();
    };
  }, [user, isAuthReady]);

  // Test Connection
  useEffect(() => {
    let retryTimeout: NodeJS.Timeout;
    
    async function testConnection(isRetry = false) {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        setIsOnline(true);
      } catch (error) {
        if (error instanceof Error && (error.message.includes('offline') || error.message.includes('unavailable') || error.message.includes('timed out'))) {
          setIsOnline(false);
          if (!isRetry) {
            // Retry once after 5 seconds
            retryTimeout = setTimeout(() => testConnection(true), 5000);
          }
        }
      }
    }
    
    testConnection();
    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      // The onAuthStateChanged will handle setting the user, 
      // but we can trigger a sync slightly after to catch local items
      setTimeout(syncLocalToCloud, 2000);
    } catch (err: any) {
      console.error("Login failed:", err);
      // Silently handle common cancellations
      if (err.code === 'auth/popup-closed-by-user') {
        // Just log it, no need to alert the user with a scary message if they just closed the popup
        console.warn("Login cancelled: Popup closed by user.");
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // resetState() will be handled by the onAuthStateChanged listener
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const handleTabChange = (value: string) => {
    if (activeTab === 'calculator' && hasUnsavedChanges) {
      setPendingTab(value);
    } else {
      setActiveTab(value);
      if (value !== 'calculator') {
        setEditingRecipe(null);
      }
    }
  };

  const handleConfirmNavigate = (action: 'save' | 'new' | 'discard') => {
    if (action === 'discard') {
      setHasUnsavedChanges(false);
      if (pendingTab) {
        setActiveTab(pendingTab);
        if (pendingTab !== 'calculator') setEditingRecipe(null);
        setPendingTab(null);
      } else {
        // This was a "Cancel" from the editor itself
        setEditingRecipe(null);
        setActiveTab('recipes');
      }
    } else if (action === 'save' || action === 'new') {
      // We need to trigger the save from the RecipeEditor
      // But we can't easily reach into it. 
      // Instead, we'll use a custom event or a ref.
      // Let's use a custom event for simplicity.
      const event = new CustomEvent('trigger-recipe-save', { 
        detail: { saveAsNew: action === 'new' } 
      });
      window.dispatchEvent(event);
    }
  };

  const handleUpdateRating = async (recipeId: string, rating: number) => {
    setRecipes(prev => prev.map(r => r.id === recipeId ? { ...r, rating } : r));
    if (user) {
      const uid = user.uid;
      try {
        const recipeRef = doc(db, 'users', uid, 'recipes', recipeId);
        await withTimeout(setDoc(recipeRef, sanitizeForFirestore({ ...recipes.find(r => r.id === recipeId), rating, uid }), { merge: true }));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/recipes/${recipeId}`);
      }
    }
  };

  const syncLocalToCloud = useCallback(async () => {
    if (!user) return;
    setIsSyncing(true);
    setSyncError(null);
    const uid = user.uid;
    
    try {
      const operations: { ref: any, data: any }[] = [];

      // Sync Recipes
      recipes.forEach(r => {
        operations.push({ ref: doc(db, 'users', uid, 'recipes', r.id), data: sanitizeForFirestore({ ...r, uid }) });
      });

      // Sync Inventory
      inventory.forEach(i => {
        operations.push({ ref: doc(db, 'users', uid, 'inventory', i.name.replace(/\//g, '_')), data: sanitizeForFirestore({ ...i, uid }) });
      });

      // Sync Shopping List
      shoppingList.forEach(s => {
        operations.push({ ref: doc(db, 'users', uid, 'shoppingList', s.id), data: sanitizeForFirestore({ ...s, uid }) });
      });

      // Sync Orders
      orders.forEach(o => {
        operations.push({ ref: doc(db, 'users', uid, 'orders', o.id), data: sanitizeForFirestore({ ...o, uid }) });
      });

      // Sync Settings
      operations.push({ ref: doc(db, 'users', uid, 'settings', 'user_settings'), data: sanitizeForFirestore({ ...userSettings, uid }) });
      operations.push({ ref: doc(db, 'users', uid, 'settings', 'costs'), data: sanitizeForFirestore({ ...costs, uid }) });

      // Chunk operations into batches of 500 (Firestore limit)
      const CHUNK_SIZE = 450; // Use slightly less than 500 to be safe
      for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
        const chunk = operations.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach(op => batch.set(op.ref, op.data));
        await withTimeout(batch.commit());
      }
      
      console.log("Cloud sync successful");
    } catch (err) {
      console.error("Cloud sync failed:", err);
      const message = err instanceof Error ? err.message : "Failed to sync with cloud";
      
      const isTransient = message.includes('timed out') || 
                          message.includes('offline') || 
                          message.includes('network error') ||
                          message.includes('unavailable');
                          
      if (!isTransient) {
        setSyncError(message);
      }
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/sync`);
    } finally {
      setIsSyncing(false);
    }
  }, [user, recipes, inventory, shoppingList, orders, userSettings, costs]);

  const handleSaveRecipe = async (recipe: Recipe, mix?: Mix) => {
    if (import.meta.env.VITE_GA_MEASUREMENT_ID) {
      console.log('Tracking Event: save_recipe', recipe.name);
      trackEvent('save_recipe', {
        category: 'Recipes',
        source: recipe.source || 'manual',
        recipe_name: recipe.name
      });
    }

    // Check for duplicates if it's a new recipe or if name/flavors changed
    const existing = recipes.find(r => r.id === recipe.id);
    const duplicate = checkDuplicateRecipe(recipe, recipes);
    
    if (duplicate && !existing) {
      setDuplicateFound(duplicate);
      setPendingRecipe(recipe);
      setPendingMix(mix || null);
      return;
    }

    // Update local state immediately for snappy UI
    setRecipes(prev => {
      const index = prev.findIndex(r => r.id === recipe.id);
      if (index > -1) {
        const updated = [...prev];
        updated[index] = recipe;
        return updated;
      }
      return [recipe, ...prev];
    });

    if (mix) {
      handleRecordMix(mix);
    }

    if (user) {
      const uid = user.uid;
      try {
        await withTimeout(setDoc(doc(db, 'users', uid, 'recipes', recipe.id), sanitizeForFirestore({ ...recipe, uid })));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/recipes/${recipe.id}`);
      }
    }
    
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    } else {
      setActiveTab('recipes');
    }
    setEditingRecipe(null);

    // After saving, check for missing flavors to offer adding to shopping list
    const missing = recipe.flavors
      .map(f => f.name)
      .filter(name => !inventory.some(inv => isFlavorMatch(inv.name, name)))
      .filter(name => !shoppingList.some(s => isFlavorMatch(s.name, name)));

    if (missing.length > 0) {
      setMissingFlavorsToShop(missing);
    }
  };

  const handleOverwrite = async () => {
    if (duplicateFound && pendingRecipe) {
      const updatedRecipe = { ...pendingRecipe, id: duplicateFound.id };
      
      // Update local state immediately
      setRecipes(prev => prev.map(r => r.id === duplicateFound.id ? updatedRecipe : r));
      
      if (pendingMix) {
        const updatedMix = { ...pendingMix, recipeId: duplicateFound.id, recipeName: updatedRecipe.name };
        handleRecordMix(updatedMix);
      }
      
      setDuplicateFound(null);
      setPendingRecipe(null);
      setPendingMix(null);
      if (pendingTab) {
        setActiveTab(pendingTab);
        setPendingTab(null);
      } else {
        setActiveTab('recipes');
      }
      setEditingRecipe(null);

      if (user) {
        const uid = user.uid;
        try {
          await withTimeout(setDoc(doc(db, 'users', uid, 'recipes', duplicateFound.id), sanitizeForFirestore({ ...updatedRecipe, uid })));
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${uid}/recipes/${duplicateFound.id}`);
        }
      }
    }
  };

  const handleNewVersion = async () => {
    if (duplicateFound && pendingRecipe) {
      const newName = getNextVersionName(duplicateFound.name, recipes);
      const newRecipe = {
        ...pendingRecipe,
        id: Math.random().toString(36).substr(2, 9),
        name: newName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: pendingRecipe.source || 'manual'
      };

      // Update local state immediately
      setRecipes(prev => [newRecipe, ...prev]);

      if (pendingMix) {
        const updatedMix = { ...pendingMix, recipeId: newRecipe.id, recipeName: newRecipe.name };
        handleRecordMix(updatedMix);
      }

      setDuplicateFound(null);
      setPendingRecipe(null);
      setPendingMix(null);
      if (pendingTab) {
        setActiveTab(pendingTab);
        setPendingTab(null);
      } else {
        setActiveTab('recipes');
      }
      setEditingRecipe(null);

      if (user) {
        const uid = user.uid;
        try {
          await withTimeout(setDoc(doc(db, 'users', uid, 'recipes', newRecipe.id), sanitizeForFirestore({ ...newRecipe, uid })));
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${uid}/recipes/${newRecipe.id}`);
        }
      }
    }
  };

  const handleDeleteRecipe = async (recipe: Recipe) => {
    setRecipeToDelete(recipe);
  };

  const confirmDelete = async () => {
    if (recipeToDelete) {
      if (user) {
        const uid = user.uid;
        try {
          await withTimeout(deleteDoc(doc(db, 'users', uid, 'recipes', recipeToDelete.id)));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `users/${uid}/recipes/${recipeToDelete.id}`);
        }
      } else {
        setRecipes(recipes.filter(r => r.id !== recipeToDelete.id));
      }
      setRecipeToDelete(null);
    }
  };

  const handleDeleteOrder = async (order: Order) => {
    setOrderToDelete(order);
  };

  const confirmDeleteOrder = async () => {
    if (orderToDelete) {
      if (user) {
        const uid = user.uid;
        try {
          await withTimeout(deleteDoc(doc(db, 'users', uid, 'orders', orderToDelete.id)));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `users/${uid}/orders/${orderToDelete.id}`);
        }
      }
      setOrders(orders.filter(o => o.id !== orderToDelete.id));
      setOrderToDelete(null);
    }
  };

  const handleImportInvoice = async (invoiceData: { items: any[], shippingCost: number, vendor: string, orderNumber: string, currency: string }) => {
    if (import.meta.env.VITE_GA_MEASUREMENT_ID) {
      console.log('Tracking Event: import_invoice', invoiceData.items.length);
      trackEvent('import_invoice', {
        category: 'Inventory',
        item_count: invoiceData.items.length
      });
    }

    const { items, shippingCost, vendor, orderNumber, currency } = invoiceData;
    const totalVolume = items.reduce((sum, item) => sum + item.volumeMl, 0);
    const shippingPerMl = totalVolume > 0 ? shippingCost / totalVolume : 0;

    const totalCost = items.reduce((sum, item) => sum + item.price, 0) + shippingCost;

    const newOrder: Order = {
      id: Math.random().toString(36).substr(2, 9),
      orderNumber,
      vendor,
      items: items.map(item => ({
        id: Math.random().toString(36).substr(2, 9),
        name: item.name,
        volumeMl: item.volumeMl,
        price: item.price
      })),
      shippingCost,
      currency,
      totalCost,
      status: 'pending',
      createdAt: Date.now(),
      uid: user?.uid || 'anonymous'
    };

    setOrders(prev => [newOrder, ...prev]);

    // Remove from shopping list
    const itemsToRemove: string[] = [];
    items.forEach(item => {
      const match = shoppingList.find(s => isFlavorMatch(s.name, item.name));
      if (match) itemsToRemove.push(match.id);
    });

    if (itemsToRemove.length > 0) {
      setShoppingList(prev => prev.filter(s => !itemsToRemove.includes(s.id)));
      if (user) {
        const uid = user.uid;
        itemsToRemove.forEach(async (id) => {
          try {
            await withTimeout(deleteDoc(doc(db, 'users', uid, 'shoppingList', id)));
          } catch (err) {
            console.error("Failed to remove shopping item from cloud:", err);
          }
        });
      }
    }

    if (user) {
      const uid = user.uid;
      try {
        await withTimeout(setDoc(doc(db, 'users', uid, 'orders', newOrder.id), sanitizeForFirestore({ ...newOrder, uid })));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/orders/${newOrder.id}`);
      }
    }

    setIsInvoiceImporting(false);
  };

  const handleMarkOrderReceived = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'received') return;

    const updatedOrder: Order = {
      ...order,
      status: 'received',
      receivedAt: Date.now()
    };

    // Update orders state
    setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));

    // Calculate total volume for shipping cost distribution
    const totalVolume = order.items.reduce((sum, item) => sum + item.volumeMl, 0);
    const shippingPerMl = totalVolume > 0 ? order.shippingCost / totalVolume : 0;

    // Move items to inventory
    const inventoryUpdates = order.items.map(item => ({
      name: item.name,
      volumeMl: item.volumeMl,
      costPerMl: Number(((item.price / item.volumeMl) + shippingPerMl).toFixed(4))
    }));

    // Process items one by one to handle duplicates/merges
    // Actually, to keep it simple and robust, we'll just use a loop and the existing logic
    // But since this is a batch, maybe we should just use a more direct approach
    
    setInventory(prev => {
      let currentInventory = [...prev];
      inventoryUpdates.forEach(item => {
        const duplicateIndex = currentInventory.findIndex(i => isFlavorMatch(i.name, item.name));
        if (duplicateIndex > -1) {
          const existing = currentInventory[duplicateIndex];
          const newVolume = (existing.volumeMl || 0) + item.volumeMl;
          currentInventory[duplicateIndex] = {
            ...existing,
            volumeMl: newVolume,
            costPerMl: item.costPerMl // Update to latest price
          };
        } else {
          currentInventory.push(item);
        }
      });
      return currentInventory;
    });

    if (user) {
      const uid = user.uid;
      try {
        // Update Order in cloud
        await withTimeout(setDoc(doc(db, 'users', uid, 'orders', order.id), sanitizeForFirestore({ ...updatedOrder, uid }), { merge: true }));
        
        // Sync full inventory to cloud to ensure consistency
        // (Batch set each updated item)
        const batch = writeBatch(db);
        inventoryUpdates.forEach(item => {
          const existing = inventory.find(i => isFlavorMatch(i.name, item.name));
          let data;
          if (existing) {
            data = sanitizeForFirestore({ 
              ...existing, 
              volumeMl: (existing.volumeMl || 0) + item.volumeMl,
              costPerMl: item.costPerMl,
              uid 
            });
          } else {
            data = sanitizeForFirestore({ ...item, uid });
          }
          batch.set(doc(db, 'users', uid, 'inventory', item.name.replace(/\//g, '_')), data);
        });
        await withTimeout(batch.commit());
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/orders_received`);
      }
    }
  };

  const processNextInvoiceItem = (remainingItems: InventoryFlavor[]) => {
    if (remainingItems.length === 0) return;

    const [currentItem, ...nextItems] = remainingItems;
    const duplicate = inventory.find(i => isFlavorMatch(i.name, currentItem.name));

    if (duplicate) {
      setDuplicateInventoryFound(duplicate);
      setPendingInventoryItem(currentItem);
      setPendingInvoiceItems(nextItems);
    } else {
      addInventoryItem(currentItem);
      // Also remove from shopping list
      const shoppingItem = shoppingList.find(si => isFlavorMatch(si.name, currentItem.name));
      if (shoppingItem) removeShoppingItem(shoppingItem.id);
      
      processNextInvoiceItem(nextItems);
    }
  };

  const handleInventoryOverwrite = async () => {
    if (duplicateInventoryFound && pendingInventoryItem) {
      const updatedItem = {
        ...duplicateInventoryFound,
        costPerMl: pendingInventoryItem.costPerMl, // Update price to latest from invoice
        volumeMl: (duplicateInventoryFound.volumeMl || 0) + (pendingInventoryItem.volumeMl || 0) // Add volumes
      };
      await updateInventoryItem(duplicateInventoryFound.name, updatedItem);
      
      // Remove from shopping list
      const shoppingListItems = shoppingList.filter(si => isFlavorMatch(si.name, pendingInventoryItem.name));
      for (const si of shoppingListItems) {
        await removeShoppingItem(si.id);
      }

      const nextBatch = [...pendingInvoiceItems];
      setDuplicateInventoryFound(null);
      setPendingInventoryItem(null);
      setPendingInvoiceItems([]); // Clear state first
      processNextInvoiceItem(nextBatch);
    }
  };

  const handleInventoryDuplicate = async () => {
    if (duplicateInventoryFound && pendingInventoryItem) {
      const newName = getNextInventoryName(pendingInventoryItem.name, inventory);
      const newItem = { ...pendingInventoryItem, name: newName };
      await internalAddInventoryItem(newItem);

      // Remove from shopping list
      const shoppingListItems = shoppingList.filter(si => isFlavorMatch(si.name, pendingInventoryItem.name));
      for (const si of shoppingListItems) {
        await removeShoppingItem(si.id);
      }

      const nextBatch = [...pendingInvoiceItems];
      setDuplicateInventoryFound(null);
      setPendingInventoryItem(null);
      setPendingInvoiceItems([]);
      processNextInvoiceItem(nextBatch);
    }
  };

  const handleInventorySkip = () => {
    const nextBatch = [...pendingInvoiceItems];
    setDuplicateInventoryFound(null);
    setPendingInventoryItem(null);
    setPendingInvoiceItems([]);
    processNextInvoiceItem(nextBatch);
  };

  const handleUpdateInventory = async (inv: InventoryFlavor[]) => {
    if (user) {
      const uid = user.uid;
      // For simplicity in this turn, we'll just set the whole inventory if small, 
      // but ideally we'd diff it. Let's do a simple set for the changed item if we had that context.
      // Since we get the whole array, we'll use a batch for safety.
      const batch = writeBatch(db);
      // First clear old (this is expensive, better to have specific add/remove handlers)
      // For now, let's just update local and let the user know cloud sync is per-item usually.
      // Actually, let's just update the local state and provide specific handlers for add/remove.
    }
    setInventory(inv);
  };

  // Specific handlers for better Firestore performance
  const internalAddInventoryItem = async (item: InventoryFlavor) => {
    // Check for safety warnings if not present
    if (!item.safetyWarnings || item.safetyWarnings.length === 0) {
      item.safetyWarnings = getSafetyWarnings(item.name);
    }

    if (user) {
      const uid = user.uid;
      const docId = item.name.replace(/\//g, '_');
      try {
        await withTimeout(setDoc(doc(db, 'users', uid, 'inventory', docId), sanitizeForFirestore({ ...item, uid })));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/inventory/${item.name}`);
      }
    } else {
      setInventory(prev => {
        const newInv = [...prev, item];
        localStorage.setItem('vape-inventory-v2', JSON.stringify(newInv));
        return newInv;
      });
    }
  };

  const addInventoryItem = async (item: InventoryFlavor) => {
    const duplicate = inventory.find(i => isFlavorMatch(i.name, item.name));
    if (duplicate) {
      setDuplicateInventoryFound(duplicate);
      setPendingInventoryItem(item);
      setPendingInvoiceItems([]); // Clear invoice queue if adding manually
      return;
    }

    await internalAddInventoryItem(item);
  };

  const removeInventoryItem = async (name: string) => {
    if (user) {
      const uid = user.uid;
      const docId = name.replace(/\//g, '_');
      try {
        await withTimeout(deleteDoc(doc(db, 'users', uid, 'inventory', docId)));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${uid}/inventory/${name}`);
      }
    } else {
      setInventory(prev => {
        const newInv = prev.filter(i => i.name !== name);
        localStorage.setItem('vape-inventory-v2', JSON.stringify(newInv));
        return newInv;
      });
    }
  };

  const updateInventoryItem = async (oldName: string, item: InventoryFlavor) => {
    // Check for safety warnings if name changed or missing
    if (oldName !== item.name || !item.safetyWarnings || item.safetyWarnings.length === 0) {
      item.safetyWarnings = getSafetyWarnings(item.name);
    }

    if (user) {
      const uid = user.uid;
      const batch = writeBatch(db);
      
      // If name changed, delete old doc and create new one
      if (oldName !== item.name) {
        const oldDocId = oldName.replace(/\//g, '_');
        batch.delete(doc(db, 'users', uid, 'inventory', oldDocId));
      }
      
      const newDocId = item.name.replace(/\//g, '_');
      batch.set(doc(db, 'users', uid, 'inventory', newDocId), sanitizeForFirestore({ ...item, uid }));
      
      try {
        await withTimeout(batch.commit());
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/inventory`);
      }
    } else {
      setInventory(prev => {
        const newInv = prev.map(i => i.name === oldName ? item : i);
        localStorage.setItem('vape-inventory-v2', JSON.stringify(newInv));
        return newInv;
      });
    }
  };

  const handleUpdateShoppingList = async (list: ShoppingItem[]) => {
    if (user) {
      // Similar to inventory, we'll handle this via specific add/remove for Firestore
    }
    setShoppingList(list);
  };

  const addShoppingItem = async (item: ShoppingItem) => {
    if (shoppingList.some(s => isFlavorMatch(s.name, item.name))) {
      return; // Already exists
    }
    setShoppingList(prev => [...prev, item]);
    if (user) {
      const uid = user.uid;
      try {
        await withTimeout(setDoc(doc(db, 'users', uid, 'shoppingList', item.id), sanitizeForFirestore({ ...item, uid })));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/shoppingList/${item.id}`);
      }
    }
  };

  const handleRecordMix = async (mix: Mix) => {
    if (import.meta.env.VITE_GA_MEASUREMENT_ID) {
      console.log('Tracking Event: record_mix', mix.recipeName);
      trackEvent('record_mix', {
        category: 'Mixing',
        recipe_name: mix.recipeName
      });
    }

    setMixes(prev => [...prev, mix]);
    
    // 1. Calculate cumulative decrements for each inventory item
    const inventoryDecrements: Record<string, number> = {};
    inventory.forEach(invItem => {
      const matchingMixFlavors = mix.flavors.filter(f => isFlavorMatch(f.name, invItem.name));
      const totalUsedMl = matchingMixFlavors.reduce((sum, f) => sum + f.ml, 0);
      if (totalUsedMl > 0) {
        inventoryDecrements[invItem.name] = totalUsedMl;
      }
    });

    const updatedInventory = inventory.map(invItem => {
      const usedMl = inventoryDecrements[invItem.name];
      if (usedMl && invItem.volumeMl !== undefined) {
        return {
          ...invItem,
          volumeMl: Number(Math.max(0, invItem.volumeMl - usedMl).toFixed(2))
        };
      }
      return invItem;
    });
    
    setInventory(updatedInventory);
    
    if (user) {
      const uid = user.uid;
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', uid, 'mixes', mix.id), sanitizeForFirestore({ ...mix, uid }));
        
        // 3. Firestore batch update using the calculated decrements
        Object.entries(inventoryDecrements).forEach(([invName, usedMl]) => {
          const invItem = inventory.find(i => i.name === invName);
          if (invItem && invItem.volumeMl !== undefined) {
            const docId = invItem.name.replace(/\//g, '_');
            const newVolume = Number(Math.max(0, invItem.volumeMl - usedMl).toFixed(2));
            batch.update(doc(db, 'users', uid, 'inventory', docId), { 
              volumeMl: newVolume 
            });
          }
        });
        
        await withTimeout(batch.commit());
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/mixes/${mix.id}`);
      }
    } else {
      localStorage.setItem('vape-inventory-v2', JSON.stringify(updatedInventory));
    }
  };

  const removeShoppingItem = async (id: string) => {
    setShoppingList(prev => prev.filter(i => i.id !== id));
    if (user) {
      const uid = user.uid;
      try {
        await withTimeout(deleteDoc(doc(db, 'users', uid, 'shoppingList', id)));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${uid}/shoppingList/${id}`);
      }
    }
  };

  const clearShoppingList = async () => {
    const oldList = [...shoppingList];
    setShoppingList([]);
    if (user) {
      const uid = user.uid;
      try {
        const batch = writeBatch(db);
        oldList.forEach(item => {
          batch.delete(doc(db, 'users', uid, 'shoppingList', item.id));
        });
        await withTimeout(batch.commit());
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${uid}/shoppingList`);
      }
    }
  };

  const handleUpdateCosts = async (newCosts: IngredientCost) => {
    setCosts(newCosts);
    if (user) {
      const uid = user.uid;
      try {
        await withTimeout(setDoc(doc(db, 'users', uid, 'settings', 'costs'), sanitizeForFirestore({ ...newCosts, uid })));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/settings/costs`);
      }
    }
  };

  const handleUpdateUserSettings = async (newSettings: UserSettings) => {
    setUserSettings(newSettings);
    if (user) {
      const uid = user.uid;
      try {
        await withTimeout(setDoc(doc(db, 'users', uid, 'settings', 'user_settings'), sanitizeForFirestore({ ...newSettings, uid })));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/settings/user_settings`);
      }
    } else {
      localStorage.setItem('vape-user-settings', JSON.stringify(newSettings));
    }
  };

  const handleExportData = () => {
    const data = {
      recipes,
      inventory,
      shoppingList,
      userSettings,
      costs,
      mixes,
      orders,
      exportedAt: new Date().toISOString(),
      version: '1.11.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vapemix-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportData = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data.recipes || !data.inventory) {
        throw new Error('Invalid backup file format');
      }

      if (user) {
        const uid = user.uid;
        setIsSyncing(true);
        try {
          const operations: { ref: any, data: any, type: 'set' | 'delete' }[] = [];
          
          // Queue deletions for existing data to ensure a clean restore
          const recipesSnap = await getDocs(collection(db, 'users', uid, 'recipes'));
          recipesSnap.forEach(d => operations.push({ ref: d.ref, data: null, type: 'delete' }));
          
          const invSnap = await getDocs(collection(db, 'users', uid, 'inventory'));
          invSnap.forEach(d => operations.push({ ref: d.ref, data: null, type: 'delete' }));
          
          const shopSnap = await getDocs(collection(db, 'users', uid, 'shoppingList'));
          shopSnap.forEach(d => operations.push({ ref: d.ref, data: null, type: 'delete' }));

          const mixesSnap = await getDocs(collection(db, 'users', uid, 'mixes'));
          mixesSnap.forEach(d => operations.push({ ref: d.ref, data: null, type: 'delete' }));

          const ordersSnap = await getDocs(collection(db, 'users', uid, 'orders'));
          ordersSnap.forEach(d => operations.push({ ref: d.ref, data: null, type: 'delete' }));

          // Queue additions from backup
          data.recipes.forEach((r: Recipe) => {
            operations.push({ 
              ref: doc(db, 'users', uid, 'recipes', r.id), 
              data: sanitizeForFirestore({ ...r, uid, source: r.source || 'import' }),
              type: 'set'
            });
          });

          data.inventory.forEach((i: InventoryFlavor) => {
            const docId = i.name.replace(/\//g, '_');
            operations.push({ 
              ref: doc(db, 'users', uid, 'inventory', docId), 
              data: sanitizeForFirestore({ ...i, uid }),
              type: 'set'
            });
          });

          if (data.shoppingList) {
            data.shoppingList.forEach((s: ShoppingItem) => {
              operations.push({ 
                ref: doc(db, 'users', uid, 'shoppingList', s.id), 
                data: sanitizeForFirestore({ ...s, uid }),
                type: 'set'
              });
            });
          }

          if (data.userSettings) {
            operations.push({ 
              ref: doc(db, 'users', uid, 'settings', 'user_settings'), 
              data: sanitizeForFirestore({ ...data.userSettings, uid }),
              type: 'set'
            });
          }
          if (data.costs) {
            operations.push({ 
              ref: doc(db, 'users', uid, 'settings', 'costs'), 
              data: sanitizeForFirestore({ ...data.costs, uid }),
              type: 'set'
            });
          }

          if (data.mixes) {
            data.mixes.forEach((m: Mix) => {
              operations.push({ 
                ref: doc(db, 'users', uid, 'mixes', m.id), 
                data: sanitizeForFirestore({ ...m, uid }),
                type: 'set'
              });
            });
          }

          if (data.orders) {
            data.orders.forEach((o: Order) => {
              operations.push({ 
                ref: doc(db, 'users', uid, 'orders', o.id), 
                data: sanitizeForFirestore({ ...o, uid }),
                type: 'set'
              });
            });
          }

          // Chunk operations into batches of 500
          const CHUNK_SIZE = 450;
          for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
            const chunk = operations.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            chunk.forEach(op => {
              if (op.type === 'set') batch.set(op.ref, op.data);
              else batch.delete(op.ref);
            });
            await withTimeout(batch.commit());
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${uid}/import`);
        } finally {
          setIsSyncing(false);
        }
      } else {
        if (data.recipes) setRecipes(data.recipes);
        if (data.inventory) setInventory(data.inventory);
        if (data.shoppingList) setShoppingList(data.shoppingList);
        if (data.userSettings) setUserSettings(data.userSettings);
        if (data.costs) setCosts(data.costs);
        if (data.mixes) setMixes(data.mixes);
        if (data.orders) setOrders(data.orders);
      }
      
      alert('Data imported successfully!');
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleAddMissingToShop = async () => {
    if (missingFlavorsToShop.length === 0) return;

    const newItems: ShoppingItem[] = missingFlavorsToShop.map(name => ({
      id: Math.random().toString(36).substr(2, 9),
      name,
      addedAt: Date.now()
    }));

    // Update local state
    setShoppingList(prev => [...prev, ...newItems]);

    // Update Firestore if logged in
    if (user) {
      const uid = user.uid;
      const batch = writeBatch(db);
      newItems.forEach(item => {
        batch.set(doc(db, 'users', uid, 'shoppingList', item.id), sanitizeForFirestore({ ...item, uid }));
      });
      try {
        await withTimeout(batch.commit());
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/shoppingList/batch`);
      }
    }

    setMissingFlavorsToShop([]);
  };

  const handleDeleteAllData = async () => {
    if (user) {
      const uid = user.uid;
      const batch = writeBatch(db);
      
      try {
        // Delete recipes
        const recipesSnap = await getDocs(collection(db, 'users', uid, 'recipes'));
        recipesSnap.forEach(d => batch.delete(d.ref));

        // Delete inventory
        const invSnap = await getDocs(collection(db, 'users', uid, 'inventory'));
        invSnap.forEach(d => batch.delete(d.ref));

        // Delete shopping list
        const shopSnap = await getDocs(collection(db, 'users', uid, 'shoppingList'));
        shopSnap.forEach(d => batch.delete(d.ref));

        // Delete mixes
        const mixesSnap = await getDocs(collection(db, 'users', uid, 'mixes'));
        mixesSnap.forEach(d => batch.delete(d.ref));

        // Delete orders
        const ordersSnap = await getDocs(collection(db, 'users', uid, 'orders'));
        ordersSnap.forEach(d => batch.delete(d.ref));

        // Delete settings
        batch.delete(doc(db, 'users', uid, 'settings', 'user_settings'));
        batch.delete(doc(db, 'users', uid, 'settings', 'costs'));

        await batch.commit();
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid} (batch delete)`);
        return;
      }
    }
    
    // Clear local storage
    localStorage.removeItem('vape-recipes-v2');
    localStorage.removeItem('vape-inventory-v2');
    localStorage.removeItem('vape-costs');
    localStorage.removeItem('vape-user-settings');
    localStorage.removeItem('vape-shopping-list');
    localStorage.removeItem('manual_gemini_api_key');

    // Reset state
    setRecipes([]);
    setInventory([]);
    setShoppingList([]);
    setUserSettings({
      defaultNicBaseMg: 100,
      defaultNicBaseType: 'PG',
      defaultTargetPgRatio: 50,
      defaultServingMl: 120,
      defaultTargetNicMg: 3,
      pgDensity: 1.038,
      vgDensity: 1.26,
      aiCustomInstructions: ''
    });
    setCosts(DEFAULT_COSTS);
    setRuntimeKey(null);

    alert('All data has been deleted successfully.');
  };

  const filteredRecipes = useMemo(() => {
    return recipes.filter(recipe => {
      const matchesSearch = recipe.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        recipe.flavors.some(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesCategory = selectedCategory === 'All' || recipe.category === selectedCategory;
      
      const matchesAvailability = !showOnlyAvailable || recipe.flavors.every(f => 
        inventory.some(inv => isFlavorMatch(inv.name, f.name))
      );

      return matchesSearch && matchesCategory && matchesAvailability;
    }).sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sortBy === 'lastMixed') {
        return (b.lastMixedAt || 0) - (a.lastMixedAt || 0);
      }
      if (sortBy === 'mostMixed') {
        return (b.mixCount || 0) - (a.mixCount || 0);
      }
      return b.createdAt - a.createdAt;
    });
  }, [recipes, searchQuery, selectedCategory, showOnlyAvailable, sortBy, inventory]);

  const handleSuggest = async (preferences?: string) => {
    setIsAiLoading(true);
    try {
      const inventoryNames = inventory.map(i => i.name);
      if (import.meta.env.VITE_GA_MEASUREMENT_ID) {
        console.log('Tracking Event: generate_recipes');
        trackEvent('generate_recipes', {
          category: 'AI',
          flavor_count: inventoryNames.length
        });
      }
      const suggestions = await suggestRecipes(
        inventoryNames, 
        preferences, 
        userSettings.geminiApiKey,
        userSettings.aiCustomInstructions
      );
      setAiSuggestions(suggestions);
    } catch (error: any) {
      console.error('AI Suggestion Error:', error);
      alert(`AI Error: ${error.message || 'Unknown error occurred'}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  if (isAppLoading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center"
        >
          <div className="w-24 h-24 bg-neutral-900 border border-neutral-800 rounded-[28%] flex items-center justify-center mb-8 shadow-2xl">
            <FlaskConical className="w-12 h-12 text-white stroke-[1.5]" />
          </div>
          
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">VapeMix AI</h1>
          <p className="text-neutral-500 text-sm font-medium uppercase tracking-[0.2em]">Mixology Lab</p>
          
          <div className="mt-12 flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.3, 0.7, 0.3]
                }}
                transition={{ 
                  repeat: Infinity, 
                  duration: 1.5,
                  delay: i * 0.2
                }}
                className="w-1.5 h-1.5 bg-neutral-700 rounded-full"
              />
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 font-sans text-neutral-900 dark:text-neutral-100 pb-20 md:pb-0">
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-neutral-900 text-white p-1.5 rounded-lg">
            <FlaskConical className="w-5 h-5" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">VapeMix AI</h1>
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <Button 
              variant="ghost" 
              size="sm" 
              className={`h-8 px-2 gap-2 text-xs transition-all ${isSyncing ? 'text-blue-500 animate-pulse' : 'text-neutral-500'}`}
              onClick={syncLocalToCloud}
              disabled={isSyncing || !isOnline}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
            </Button>
          )}
          {user ? (
            <div className="flex items-center gap-2 mr-2">
              <div className="hidden sm:flex flex-col items-end">
                <div className="flex items-center gap-1.5">
                  {isOnline ? (
                    <>
                      <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider">Online</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Offline (Cached)</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    </>
                  )}
                </div>
                <span className="text-[9px] text-neutral-400 truncate max-w-[100px]">{user.email}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center outline-none focus:ring-2 focus:ring-blue-500/20 rounded-full transition-shadow">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="User" className={`w-8 h-8 rounded-full border ${isOnline ? 'border-neutral-200' : 'border-amber-200 grayscale-[0.5]'}`} referrerPolicy="no-referrer" />
                  ) : (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isOnline ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                      {isOnline ? <UserIcon className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
                    </div>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setActiveTab('settings')}>
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/10" onClick={handleLogout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Sign Out</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="h-8 gap-2 text-xs" onClick={handleLogin}>
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setActiveTab('settings')}>
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!recipeToDelete} onOpenChange={(open) => !open && setRecipeToDelete(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Recipe</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{recipeToDelete?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setRecipeToDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete Recipe</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!orderToDelete} onOpenChange={(open) => !open && setOrderToDelete(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete order "{orderToDelete?.orderNumber}" from "{orderToDelete?.vendor}"? 
              {orderToDelete?.status === 'received' && " This will remove it from your history but will NOT affect your current flavor stash levels."}
              {orderToDelete?.status === 'pending' && " This will cancel the tracking for this pending order."}
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setOrderToDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteOrder}>Delete Order</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SafetyDisclaimerDialog 
        open={showSafetyDisclaimer} 
        onOpenChange={() => {}} 
        onAcknowledge={() => {
          handleUpdateUserSettings({ ...userSettings, acknowledgedSafety: true });
          setShowSafetyDisclaimer(false);
        }}
        showAcknowledgeButton={true}
      />

      <SafetyDisclaimerDialog
        open={isViewingSafety}
        onOpenChange={setIsViewingSafety}
        showAcknowledgeButton={false}
      />

      <ImportRecipeDialog 
        open={isImporting} 
        onOpenChange={setIsImporting} 
        onImport={handleSaveRecipe} 
        userSettings={userSettings}
      />

      <ImportInvoiceDialog
        open={isInvoiceImporting}
        onOpenChange={setIsInvoiceImporting}
        onImport={handleImportInvoice}
        userSettings={userSettings}
        orders={orders}
      />

      <StashImportDialog
        open={isStashImporting}
        onOpenChange={setIsStashImporting}
        onImport={handleImportStash}
      />

      <Dialog open={missingFlavorsToShop.length > 0} onOpenChange={(open) => !open && setMissingFlavorsToShop([])}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Missing Ingredients</DialogTitle>
            <DialogDescription>
              This recipe contains {missingFlavorsToShop.length} flavors you don't have in stock. Would you like to add them all to your shopping list?
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[200px] overflow-y-auto py-2 space-y-1">
            {missingFlavorsToShop.map((name, i) => (
              <div key={i} className="text-xs text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 px-2 py-1 rounded border border-neutral-100 dark:border-neutral-800">
                {name}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMissingFlavorsToShop([])}>No Thanks</Button>
            <Button onClick={handleAddMissingToShop}>Add All to List</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuplicateRecipeDialog 
        open={!!duplicateFound} 
        onOpenChange={(open) => !open && setDuplicateFound(null)} 
        duplicate={duplicateFound} 
        pending={pendingRecipe} 
        onOverwrite={handleOverwrite} 
        onNewVersion={handleNewVersion} 
      />

      <DuplicateInventoryDialog
        open={!!duplicateInventoryFound}
        onOpenChange={(open) => !open && setDuplicateInventoryFound(null)}
        duplicate={duplicateInventoryFound}
        pending={pendingInventoryItem}
        onOverwrite={handleInventoryOverwrite}
        onDuplicate={handleInventoryDuplicate}
        onSkip={handleInventorySkip}
      />

      <Dialog open={!!pendingTab} onOpenChange={(open) => !open && setPendingTab(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
              Unsaved Changes
            </DialogTitle>
            <DialogDescription className="pt-2">
              You have unsaved changes to your recipe. What would you like to do before leaving?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <Button 
              variant="outline" 
              className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800"
              onClick={() => handleConfirmNavigate('save')}
            >
              <span className="font-bold text-sm">Save & Exit</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 font-normal">Overwrite the existing recipe and continue.</span>
            </Button>
            <Button 
              variant="outline" 
              className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-200 dark:hover:border-green-800"
              onClick={() => handleConfirmNavigate('new')}
            >
              <span className="font-bold text-sm">Save as New Version & Exit</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 font-normal">Create a new version and continue.</span>
            </Button>
            <Button 
              variant="outline" 
              className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800"
              onClick={() => handleConfirmNavigate('discard')}
            >
              <span className="font-bold text-sm text-red-600 dark:text-red-400">Discard Changes</span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 font-normal">Lose all changes and continue.</span>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingTab(null)}>Stay on Page</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="max-w-4xl mx-auto p-4">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="hidden md:grid w-full grid-cols-4 mb-8">
            <TabsTrigger value="recipes" className="gap-2"><Book className="w-4 h-4" /> Recipes</TabsTrigger>
            <TabsTrigger value="calculator" className="gap-2"><PlusCircle className="w-4 h-4" /> New Mix</TabsTrigger>
            <TabsTrigger value="inventory" className="gap-2"><Droplets className="w-4 h-4" /> Inventory</TabsTrigger>
            <TabsTrigger value="ai" className="gap-2"><Sparkles className="w-4 h-4" /> AI Lab</TabsTrigger>
          </TabsList>

          <TabsContent value="recipes" className="mt-0">
            <div className="flex flex-col gap-4">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <Input 
                      placeholder="Search recipes or ingredients..." 
                      className="h-10 pl-10 pr-10 bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2 items-center">
                    <Button 
                      variant="outline" 
                      className="h-10 gap-2 px-3 bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 dark:text-neutral-300"
                      onClick={() => setIsImporting(true)}
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">Import</span>
                    </Button>
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                      <SelectTrigger className="h-10 w-full sm:w-[140px] bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
                        <SelectValue placeholder="Category">
                          {selectedCategory === 'All' ? 'All Categories' : selectedCategory}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All">All Categories</SelectItem>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="h-10 w-full sm:w-[120px] bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
                        <SelectValue placeholder="Sort by">
                          {RECIPE_SORT_OPTIONS[sortBy]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="newest">Newest</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="rating">Rating</SelectItem>
                        <SelectItem value="lastMixed">Last Mixed</SelectItem>
                        <SelectItem value="mostMixed">Most Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button 
                    variant={showOnlyAvailable ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowOnlyAvailable(!showOnlyAvailable)}
                    className={`h-8 text-xs ${showOnlyAvailable ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}
                  >
                    {showOnlyAvailable ? <Check className="w-3 h-3 mr-1" /> : null}
                    Available Flavors Only
                  </Button>
                  <span className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold ml-auto">
                    {filteredRecipes.length} Recipes
                  </span>
                </div>
              </div>

              <div className="grid gap-3">
                {filteredRecipes.map(recipe => (
                  <RecipeCard 
                    key={recipe.id} 
                    recipe={recipe} 
                    inventory={inventory}
                    shoppingList={shoppingList}
                    orders={orders}
                    mixes={mixes.filter(m => m.recipeId === recipe.id)}
                    onEdit={() => {
                      setEditingRecipe(recipe);
                      setActiveTab('calculator');
                    }}
                    onDelete={() => handleDeleteRecipe(recipe)}
                    onUpdateRating={(rating) => handleUpdateRating(recipe.id, rating)}
                    onEditFlavor={(flavorName) => {
                      const existing = inventory.find(i => isFlavorMatch(i.name, flavorName));
                      if (existing) {
                        startEditing(existing);
                      } else {
                        startEditing({ name: flavorName } as InventoryFlavor, 'stash');
                      }
                    }}
                  />
                ))}
                {filteredRecipes.length === 0 && (
                  <div className="text-center py-12 text-neutral-500">
                    <Book className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p>No recipes found. Start by creating one!</p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="calculator" className="mt-0 overflow-visible">
            <RecipeEditor 
              recipe={editingRecipe} 
              recipes={recipes}
              inventory={inventory}
              onSave={handleSaveRecipe} 
              onCancel={() => {
                if (hasUnsavedChanges) {
                  setPendingTab('recipes');
                } else {
                  setEditingRecipe(null);
                  setActiveTab('recipes');
                }
              }}
              costs={costs}
              userSettings={userSettings}
              shoppingList={shoppingList}
              orders={orders}
              onAddInventoryItem={addInventoryItem}
              onAddShoppingItem={addShoppingItem}
              setHasUnsavedChanges={setHasUnsavedChanges}
              onStartEditingFlavor={startEditing}
            />
          </TabsContent>

          <TabsContent value="inventory" className="mt-0">
            <InventoryManager 
              inventory={inventory} 
              recipes={recipes}
              shoppingList={shoppingList}
              orders={orders}
              onAddInventoryItem={addInventoryItem}
              onRemoveInventoryItem={removeInventoryItem}
              onUpdateInventoryItem={updateInventoryItem}
              onAddShoppingItem={addShoppingItem}
              onRemoveShoppingItem={removeShoppingItem}
              onClearShoppingList={clearShoppingList}
              onMarkOrderReceived={handleMarkOrderReceived}
              onDeleteOrder={handleDeleteOrder}
              userSettings={userSettings}
              onImportInvoice={() => setIsInvoiceImporting(true)}
              onImportStash={() => setIsStashImporting(true)}
              onFilterRecipes={(filter) => {
                setSearchQuery(filter);
                setActiveTab('recipes');
              }}
              onStartEditingFlavor={startEditing}
              sharedEditingItem={editingItem}
              setSharedEditingItem={setEditingItem}
            />
          </TabsContent>

          <TabsContent value="ai" className="mt-0">
            <AiLab 
              inventory={inventory.map(i => i.name)} 
              suggestions={aiSuggestions} 
              onSuggest={handleSuggest} 
              isLoading={isAiLoading}
              onUseRecipe={(recipe) => {
                setEditingRecipe({
                  ...recipe,
                  id: Math.random().toString(36).substr(2, 9),
                  servingMl: userSettings.defaultServingMl,
                  targetNicMg: userSettings.defaultTargetNicMg,
                  targetPgRatio: userSettings.defaultTargetPgRatio,
                  nicBaseMg: userSettings.defaultNicBaseMg,
                  nicBaseType: userSettings.defaultNicBaseType,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  source: 'ai'
                });
                setActiveTab('calculator');
              }}
              runtimeKey={runtimeKey}
              onSelectKey={handleSelectKey}
              hasAiStudio={hasAiStudio}
              userSettings={userSettings}
              onUpdateSettings={handleUpdateUserSettings}
              isOnline={isOnline}
            />
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <SettingsPanel 
              costs={costs} 
              onUpdate={handleUpdateCosts} 
              userSettings={userSettings}
              onUpdateSettings={handleUpdateUserSettings}
              runtimeKey={runtimeKey} 
              onSelectKey={handleSelectKey}
              user={user}
              onLogin={handleLogin}
              onLogout={handleLogout}
              onSync={syncLocalToCloud}
              isSyncing={isSyncing}
              syncError={syncError}
              onExport={handleExportData}
              onImport={handleImportData}
              onDeleteAllData={handleDeleteAllData}
              onOpenPrivacy={() => setShowPrivacyPolicy(true)}
              onOpenSafety={() => setIsViewingSafety(true)}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Mobile Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 md:hidden flex justify-around p-2 z-20">
        <MobileNavItem active={activeTab === 'recipes'} onClick={() => handleTabChange('recipes')} icon={<Book className="w-5 h-5" />} label="Recipes" />
        <MobileNavItem active={activeTab === 'calculator'} onClick={() => { 
          if (activeTab === 'calculator' && hasUnsavedChanges) {
            // Already here but might want to reset or something? 
            // Usually clicking current tab does nothing.
          } else {
            setEditingRecipe(null); 
            handleTabChange('calculator'); 
          }
        }} icon={<PlusCircle className="w-5 h-5" />} label="Mix" />
        <MobileNavItem active={activeTab === 'inventory'} onClick={() => handleTabChange('inventory')} icon={<Droplets className="w-5 h-5" />} label="Stash" />
        <MobileNavItem active={activeTab === 'ai'} onClick={() => handleTabChange('ai')} icon={<Sparkles className="w-5 h-5" />} label="AI" />
      </nav>

      <div className="text-center py-10 pb-28 md:pb-12 space-y-3 bg-neutral-50/50 dark:bg-neutral-900/50 border-t border-neutral-100 dark:border-neutral-800 mt-8">
        <p className="text-xs md:text-sm text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.2em] font-bold">VapeMix AI • Crafted for {flavor(true)}</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-[11px] md:text-xs">
          <p className="text-neutral-400 dark:text-neutral-500 uppercase tracking-widest font-bold">Version {VERSION}</p>
          <span className="hidden sm:block w-1.5 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800" />
          <a 
            href="https://ko-fi.com/vapemixai" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 uppercase tracking-widest font-bold hover:text-red-500 transition-colors"
          >
            <Heart className="w-3.5 h-3.5 fill-red-500/20 text-red-500" />
            Support Project
          </a>
          <span className="hidden sm:block w-1.5 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800" />
          <button 
            onClick={() => setShowPrivacyPolicy(true)}
            className="text-neutral-500 dark:text-neutral-400 uppercase tracking-widest font-bold hover:text-purple-500 transition-colors"
          >
            Privacy Policy
          </button>
        </div>
      </div>

      <PrivacyPolicyDialog open={showPrivacyPolicy} onOpenChange={setShowPrivacyPolicy} />

      <FlavorEditDialog 
        item={editingItem} 
        initialFocusField={initialFocusField}
        onSave={(oldName, item) => {
          if (pendingAddTarget === 'shopping') {
            addShoppingItem({ id: crypto.randomUUID(), name: item.name, addedAt: Date.now() });
          } else {
            // Check if this is a new name that matches an existing flavor
            const duplicate = inventory.find(i => isFlavorMatch(i.name, item.name) && i.name !== oldName);
            
            if (duplicate && !oldName) {
              // We are adding a new item that matches an existing one
              addInventoryItem(item);
            } else if (duplicate && oldName) {
              // We are renaming an item to something that already exists
              // For now, let's just update as is, but ideally would merge.
              // Given the scale, merging here might be complex without a dedicated handler.
              // Let's at least use isFlavorMatch for the 'isNew' check.
              updateInventoryItem(oldName, item);
            } else {
              const isNew = !oldName || !inventory.some(i => i.name === oldName);
              if (isNew) {
                internalAddInventoryItem(item);
              } else {
                updateInventoryItem(oldName, item);
              }
            }
          }
          setEditingItem(null);
          setPendingAddTarget(null);
          setInitialFocusField(null);
        }} 
        onCancel={() => {
          setEditingItem(null);
          setPendingAddTarget(null);
          setInitialFocusField(null);
        }} 
      />

      <AnimatePresence>
        {cookieConsent === null && (
          <motion.div 
            key="cookie-consent"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-20 md:bottom-6 left-6 right-6 md:left-auto md:max-w-md z-50"
          >
            <Card className="shadow-2xl border-purple-100 dark:border-purple-900 overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-purple-500" />
              <CardContent className="p-6">
                <div className="flex gap-4">
                  <div className="p-2 bg-purple-50 dark:bg-purple-950 rounded-full h-fit">
                    <Droplets className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-bold text-sm">A quick {flavor()} check?</h3>
                    <p className="text-xs text-neutral-500 leading-relaxed">
                      We use minimal cookies (like Google Analytics) to understand how you use the app. No ads, ever. 
                    </p>
                    <div className="flex gap-3 pt-2">
                      <Button 
                        size="sm" 
                        onClick={() => {
                          setCookieConsent(true);
                          localStorage.setItem('vape-cookie-consent', 'true');
                        }}
                        className="bg-purple-600 hover:bg-purple-700 text-white h-8 text-xs px-4"
                      >
                        Accept
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setCookieConsent(false);
                          localStorage.setItem('vape-cookie-consent', 'false');
                        }}
                        className="h-8 text-xs text-neutral-500 hover:text-neutral-700"
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PrivacyPolicyDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col p-0 border-purple-100 dark:border-purple-900">
        <DialogHeader className="p-6 pb-2">
          <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-1">
            <AlertCircle className="w-5 h-5" />
            <p className="text-[10px] font-bold uppercase tracking-widest">Transparency & Data</p>
          </div>
          <DialogTitle className="text-2xl font-bold tracking-tight">Privacy Policy</DialogTitle>
          <DialogDescription>
            Last updated: April 22, 2026
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 p-6 pt-2 overflow-y-auto">
          <div className="space-y-6 pb-6">
            <section className="space-y-3">
              <h3 className="font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                Your Data, Your Ownership
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                VapeMix AI is built on a "user-first" philosophy. We do not sell, rent, or monetize your personal information or recipes. Your data belongs to you.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                Google Authentication
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                When you sign in with Google, we receive your basic profile information (email, name, and profile picture). We use this exclusively to:
              </p>
              <ul className="list-disc list-inside text-sm text-neutral-600 dark:text-neutral-400 space-y-1 pl-2">
                <li>Identify your account for cloud synchronization.</li>
                <li>Secure your private recipes and inventory data.</li>
                <li>Personalize your mixing dashboard with your name/avatar.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h3 className="font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                Cloud Storage (Firebase)
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Your recipes, flavor stash, and settings are stored in **Google Firebase**, a secure enterprise-grade database. Access to your data is strictly limited to your authenticated UID.
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <span className="w-1 h-4 bg-purple-500 rounded-full" />
                Analytics & Cookies
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                We use **Google Analytics 4 (GA4)** only if you provide explicit consent. This data is used to understand feature usage and improve the application. We implement User-ID stitching to ensure an accurate, consistent experience across your devices.
              </p>
            </section>

            <section className="space-y-3 p-4 bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900 rounded-lg">
              <h3 className="font-bold text-red-700 dark:text-red-400 flex items-center gap-2 text-sm">
                <Trash2 className="w-4 h-4" />
                Right to be Forgotten
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                You have the absolute right to delete all your data at any time. You can use the "Delete All User Data" button in the Settings panel to permanently erase all records from both your local device and our cloud servers.
              </p>
            </section>

            <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 text-[10px] text-neutral-400 text-center italic">
              Crafted with respect for privacy by VapeMix AI.
            </div>
          </div>
        </div>
        <DialogFooter className="p-4 bg-neutral-50 dark:bg-neutral-950 border-t border-neutral-100 dark:border-neutral-800">
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700">
            Close & Return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MobileNavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 transition-colors ${active ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-600'}`}
    >
      {icon}
      <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
    </button>
  );
}

interface RecipeCardProps {
  recipe: Recipe;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateRating: (rating: number) => void;
  inventory: InventoryFlavor[];
  shoppingList: ShoppingItem[];
  orders?: Order[];
  onEditFlavor?: (flavorName: string) => void;
  key?: string;
}

function StarRating({ rating = 0, onChange, size = 16 }: { rating?: number, onChange?: (r: number) => void, size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onChange) {
              onChange(rating === star ? 0 : star);
            }
          }}
          className={`transition-colors ${onChange ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
        >
          <Star 
            size={size} 
            className={`${star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-neutral-200 fill-neutral-100'}`} 
          />
        </button>
      ))}
    </div>
  );
}

function ImportRecipeDialog({ 
  open, 
  onOpenChange, 
  onImport,
  userSettings
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  onImport: (recipe: Recipe) => void,
  userSettings: UserSettings
}) {
  const [importText, setImportText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const content = importText.trim();
      if (!content) throw new Error("Please paste the recipe text to import.");

      const parsed = await parseImportedRecipe(content, userSettings.geminiApiKey);
      
      if (!parsed.recipeFound || !parsed.flavors || parsed.flavors.length === 0) {
        throw new Error("Could not find a valid e-liquid recipe in the pasted text. Please make sure you copied the flavor list and percentages.");
      }

      // Destructure to remove recipeFound and prepare flavors with IDs
      const { recipeFound, flavors, ...recipeData } = parsed;

      const newRecipe: Recipe = {
        servingMl: userSettings.defaultServingMl,
        targetNicMg: userSettings.defaultTargetNicMg,
        targetPgRatio: userSettings.defaultTargetPgRatio,
        nicBaseMg: userSettings.defaultNicBaseMg,
        nicBaseType: userSettings.defaultNicBaseType,
        ...recipeData,
        flavors: flavors.map((f: any) => ({
          ...f,
          id: Math.random().toString(36).substr(2, 9)
        })),
        id: Math.random().toString(36).substr(2, 9),
        source: 'import',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      if (import.meta.env.VITE_GA_MEASUREMENT_ID) {
        console.log('Tracking Event: import_recipe_success', newRecipe.name);
        trackEvent('import_recipe_success', {
          category: 'Recipes',
          recipe_name: newRecipe.name
        });
      }

      onImport(newRecipe);
      onOpenChange(false);
      setImportText('');
    } catch (err: any) {
      if (import.meta.env.VITE_GA_MEASUREMENT_ID) {
        console.log('Tracking Event: import_recipe_failure', err.message);
        trackEvent('import_recipe_failure', {
          category: 'Recipes',
          error_message: err.message || 'Unknown error'
        });
      }
      setError(err.message || "Failed to import recipe.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Recipe</DialogTitle>
          <DialogDescription>
            Simply copy and paste the recipe text (or the whole page content) from All The Flavors or E-Liquid Recipes into the text area below.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="text" className="text-sm font-medium">Recipe Details</Label>
            <textarea 
              id="text"
              placeholder="Paste recipe details here..."
              className="min-h-[250px] w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:text-neutral-100"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <p className="text-[10px] text-neutral-400 italic">
              Tip: You can select all text (Ctrl+A) on the recipe page, copy it, and paste it here. Our AI will handle the rest!
            </p>
          </div>
          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2 rounded border border-red-100 dark:border-red-900">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={isLoading || !importText.trim()}>
            {isLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Import Recipe
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportInvoiceDialog({ 
  open, 
  onOpenChange, 
  onImport,
  userSettings,
  orders
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  onImport: (data: { items: any[], shippingCost: number, vendor: string, orderNumber: string, currency: string }) => void,
  userSettings: UserSettings,
  orders: Order[]
}) {
  const [importText, setImportText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractTextFromPdf = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        useSystemFonts: true,
        isEvalSupported: false 
      });
      const pdf = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str || '')
          .join(' ');
        fullText += pageText + '\n';
      }
      
      if (!fullText.trim()) {
        throw new Error("No text found in PDF. This might be a scanned document (image) which cannot be read directly. Please try copy-pasting the text if possible.");
      }
      
      return fullText;
    } catch (err: any) {
      console.error("Internal PDF extraction error:", err);
      if (err.message?.includes("No text found")) throw err;
      throw new Error(`PDF Error: ${err.message || 'Unknown parsing error'}`);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError("Please upload a PDF file.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const text = await extractTextFromPdf(file);
      setImportText(text);
    } catch (err: any) {
      setError(err.message || "Failed to extract text from PDF. You may need to paste the text manually.");
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImport = async (force: boolean = false) => {
    setIsLoading(true);
    setError(null);
    setDuplicateWarning(null);
    try {
      const content = importText.trim();
      if (!content) throw new Error("Please paste the invoice text or upload a PDF to import.");

      const parsed = await parseInvoice(content, userSettings.geminiApiKey);
      
      if (!parsed.items || parsed.items.length === 0) {
        throw new Error("Could not find any flavor items in the provided content. Please make sure the text contains the item list, volumes, and prices.");
      }

      // Duplicate check
      if (!force) {
        let isDuplicate = false;
        let warningMsg = "";

        // Check order number
        if (parsed.orderNumber && orders.some(o => o.orderNumber === parsed.orderNumber)) {
          isDuplicate = true;
          warningMsg = `An order with invoice number "${parsed.orderNumber}" already exists in your history.`;
        } else {
          // Check contents (simple heuristic: same item count and same first/mid/last items)
          const potentialMatches = orders.filter(o => o.items.length === parsed.items.length);
          for (const match of potentialMatches) {
             const allMatch = match.items.every((mi, idx) => {
               const pi = parsed.items[idx];
               return isFlavorMatch(mi.name, pi.name) && Math.abs(mi.volumeMl - pi.volumeMl) < 0.1;
             });
             if (allMatch) {
               isDuplicate = true;
               warningMsg = "An order with exactly the same items and volumes already exists in your history.";
               break;
             }
          }
        }

        if (isDuplicate) {
          setDuplicateWarning(warningMsg);
          setIsLoading(false);
          return;
        }
      }

      onImport(parsed);
      onOpenChange(false);
      setImportText('');
    } catch (err: any) {
      setError(err.message || "Failed to import invoice.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      onOpenChange(val);
      if (!val) {
        setError(null);
        setDuplicateWarning(null);
      }
    }}>
      <DialogContent className="sm:max-w-[500px] flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Invoice</DialogTitle>
          <DialogDescription>
            Upload a PDF invoice or paste the text from your flavor order. Our AI will extract the items and update your stash.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-1 py-4">
          <div className="grid gap-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1 gap-2 border-dashed border-neutral-300 dark:border-neutral-700 h-16 flex-col"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                >
                  <FileIcon className="w-5 h-5 text-neutral-400" />
                  <span className="text-xs">Upload PDF Invoice</span>
                </Button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept=".pdf" 
                  className="hidden" 
                />
              </div>
              
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-neutral-200 dark:border-neutral-800"></span>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-white dark:bg-neutral-900 px-2 text-neutral-400 font-bold">Or paste text</span>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="invoice-text" className="text-sm font-medium">Invoice Text</Label>
                <textarea 
                  id="invoice-text"
                  placeholder="Paste invoice content here..."
                  className="min-h-[200px] w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:text-neutral-100"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <p className="text-[10px] text-neutral-400 italic">
                  Tip: If PDF upload fails, you can copy the text from your order confirmation email.
                </p>
              </div>
            </div>
            
            {duplicateWarning && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 rounded-lg flex items-start gap-2 text-amber-900 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <div className="text-xs">
                  <p className="font-bold mb-1">Potential Duplicate Found</p>
                  <p>{duplicateWarning}</p>
                  <p className="mt-2 font-medium">Are you sure you want to process this invoice again?</p>
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2 rounded border border-red-100 dark:border-red-900">{error}</p>
            )}
          </div>
        </div>
        
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {duplicateWarning ? (
            <Button variant="default" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => handleImport(true)} disabled={isLoading}>
              {isLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <AlertTriangle className="w-4 h-4 mr-2" />}
              Import Anyway
            </Button>
          ) : (
            <Button onClick={() => handleImport()} disabled={isLoading || !importText.trim()}>
              {isLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Process Invoice
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateRecipeDialog({ 
  open, 
  onOpenChange, 
  duplicate, 
  pending, 
  onOverwrite, 
  onNewVersion 
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  duplicate: Recipe | null, 
  pending: Recipe | null, 
  onOverwrite: () => void, 
  onNewVersion: () => void 
}) {
  if (!duplicate || !pending) return null;

  const isSameName = duplicate.name.toLowerCase() === pending.name.toLowerCase();
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <PlusCircle className="w-5 h-5" />
            Possible Duplicate Found
          </DialogTitle>
          <DialogDescription className="pt-2">
            {isSameName ? (
              <>A recipe named <strong>"{duplicate.name}"</strong> already exists.</>
            ) : (
              <>A recipe with the <strong>exact same {flavors()} and percentages</strong> already exists as <strong>"{duplicate.name}"</strong>.</>
            )}
            <br /><br />
            What would you like to do?
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-4">
          <Button 
            variant="outline" 
            className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800"
            onClick={onOverwrite}
          >
            <span className="font-bold text-sm">Overwrite Existing</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400 font-normal">Replace the existing recipe with this one.</span>
          </Button>
          <Button 
            variant="outline" 
            className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-200 dark:hover:border-green-800"
            onClick={onNewVersion}
          >
            <span className="font-bold text-sm">Create New Version</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400 font-normal">Save as a new recipe with an incremented version number.</span>
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateInventoryDialog({ 
  open, 
  onOpenChange, 
  duplicate, 
  pending, 
  onOverwrite, 
  onDuplicate,
  onSkip
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  duplicate: InventoryFlavor | null, 
  pending: InventoryFlavor | null, 
  onOverwrite: () => void, 
  onDuplicate: () => void,
  onSkip: () => void
}) {
  if (!duplicate || !pending) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" />
            Duplicate {flavor(true)} Found
          </DialogTitle>
          <DialogDescription className="pt-2">
            The {flavor()} <strong>"{duplicate.name}"</strong> already exists in your stash.
            <br /><br />
            What would you like to do?
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-4">
          <Button 
            variant="outline" 
            className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-blue-50 hover:border-blue-200"
            onClick={onOverwrite}
          >
            <span className="font-bold text-sm">Merge & Update</span>
            <span className="text-xs text-neutral-500 font-normal">Add new volume to existing total and update the price per ml.</span>
          </Button>
          <Button 
            variant="outline" 
            className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-green-50 hover:border-green-200"
            onClick={onDuplicate}
          >
            <span className="font-bold text-sm">Create Duplicate</span>
            <span className="text-xs text-neutral-500 font-normal">Add as a new item with an incremented number.</span>
          </Button>
          <Button 
            variant="outline" 
            className="justify-start h-auto py-3 px-4 flex flex-col items-start gap-1 hover:bg-neutral-50 hover:border-neutral-200"
            onClick={onSkip}
          >
            <span className="font-bold text-sm">Skip</span>
            <span className="text-xs text-neutral-500 font-normal">Do not add this {flavor()} and continue.</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MixHistoryDialog({ 
  open, 
  onOpenChange, 
  mixes,
  inventory = [],
  orders = []
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  mixes: Mix[],
  inventory?: InventoryFlavor[],
  orders?: Order[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Mix History</DialogTitle>
          <DialogDescription>
            A record of every time this recipe was mixed.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4 py-4">
            {mixes.sort((a, b) => b.mixedAt - a.mixedAt).map((mix) => {
              const daysSinceMixed = Math.floor((Date.now() - mix.mixedAt) / (1000 * 60 * 60 * 24));
              const steepTime = mix.steepingDays || 0;
              const isSteeped = steepTime === 0 || daysSinceMixed >= steepTime;
              const daysRemaining = Math.max(0, steepTime - daysSinceMixed);
              const progressPct = steepTime > 0 ? Math.min(100, (daysSinceMixed / steepTime) * 100) : 100;

              return (
                <div key={mix.id} className="p-4 rounded-lg border border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                        {new Date(mix.mixedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <p className="text-[10px] text-neutral-400 font-medium font-mono">
                        {daysSinceMixed === 0 ? 'Mixed Today' : `${daysSinceMixed} ${daysSinceMixed === 1 ? 'day' : 'days'} ago`}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant={isSteeped ? "secondary" : "default"} className={`text-[9px] uppercase tracking-wider ${isSteeped ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-none' : 'bg-blue-600 text-white border-none'}`}>
                        {isSteeped ? 'Ready to Vape' : `Steeping: ${daysRemaining}d Left`}
                      </Badge>
                      {mix.flavorIntensity !== undefined && mix.flavorIntensity !== 100 && (
                        <Badge variant="outline" className="text-[8px] h-4 px-1.5 font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-500 border-amber-100 dark:border-amber-900/30">
                          <Beaker size={8} className="mr-0.5" /> Scaled: {mix.flavorIntensity}%
                        </Badge>
                      )}
                    </div>
                  </div>

                  {(mix.totalVolume || mix.targetPgRatio !== undefined || mix.targetNicMg !== undefined) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] items-center py-1.5 border-y border-neutral-100/50 dark:border-neutral-800/50">
                      {mix.totalVolume && (
                        <div className="flex items-center gap-1 text-neutral-500">
                          <Beaker size={10} />
                          <span>Total: <span className="text-neutral-700 dark:text-neutral-300 font-bold">{mix.totalVolume}ml</span></span>
                        </div>
                      )}
                      {mix.targetPgRatio !== undefined && (
                        <div className="flex items-center gap-1 text-neutral-500">
                          <Droplets size={10} />
                          <span>Ratio: <span className="text-neutral-700 dark:text-neutral-300 font-bold">{mix.targetPgRatio}/{100 - mix.targetPgRatio} PG/VG</span></span>
                        </div>
                      )}
                      {mix.targetNicMg !== undefined && (
                        <div className="flex items-center gap-1 text-neutral-500">
                          <Zap size={10} />
                          <span>Nic: <span className="text-neutral-700 dark:text-neutral-300 font-bold">{mix.targetNicMg}mg</span></span>
                        </div>
                      )}
                    </div>
                  )}

                  {steepTime > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[9px] font-bold text-neutral-400 uppercase tracking-tighter">
                        <span>Steep Progress</span>
                        <span>{Math.round(progressPct)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                        <motion.div 
                          className={`h-full ${isSteeped ? 'bg-green-500' : 'bg-blue-500'}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${progressPct}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="pt-1.5 border-t border-neutral-100/50 dark:border-neutral-800/50 space-y-1">
                    {mix.flavors.map((f) => {
                      const isInStock = inventory.some(inv => isFlavorMatch(inv.name, f.name));
                      const isInOrder = orders.some(o => o.status === 'pending' && o.items.some(oi => isFlavorMatch(oi.name, f.name)));
                      
                      return (
                        <div key={f.id || f.name} className="flex justify-between text-xs">
                          <span className="text-neutral-600 dark:text-neutral-400 text-[11px] flex items-center gap-1.5">
                            {f.name}
                            {f.isSubstitution && (
                              <span className="text-[9px] text-amber-600 dark:text-amber-500 font-medium italic">
                                (Substituted)
                              </span>
                            )}
                            {isInOrder && !isInStock && (
                              <Badge variant="outline" className="h-3.5 px-1 text-[8px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-900 border-none font-bold uppercase tracking-tighter">
                                <Package className="w-2 h-2 mr-0.5" /> On Order
                              </Badge>
                            )}
                          </span>
                          <span className="font-mono text-neutral-400 dark:text-neutral-500 text-[11px] whitespace-nowrap">
                            {f.ml ? `${f.ml.toFixed(2)}ml` : ''} ({f.percentage}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {mixes.length === 0 && (
              <div className="text-center py-12 text-neutral-400 dark:text-neutral-500 italic text-sm">
                No mix history found for this recipe.
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecipeCard({ recipe, onEdit, onDelete, onUpdateRating, inventory, shoppingList, orders = [], mixes = [], onEditFlavor }: RecipeCardProps & { mixes?: Mix[] }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [expandedFlavorNotes, setExpandedFlavorNotes] = useState<Record<string, boolean>>({});
  
  const handleExportText = () => {
    let text = `${recipe.name}\n`;
    text += `==============================\n`;
    if (recipe.category) text += `Category: ${recipe.category}\n`;
    text += `PG/VG Ratio: ${recipe.targetPgRatio}/${100 - recipe.targetPgRatio}\n`;
    text += `Nicotine: ${recipe.targetNicMg}mg\n`;
    if (recipe.steepingDays) text += `Steep Time: ${recipe.steepingDays} days\n`;
    text += `------------------------------\n`;
    text += `${flavors(true)}:\n`;
    recipe.flavors.forEach(f => {
      text += `- ${f.name}: ${f.percentage}%${f.notes ? ` (Note: ${f.notes})` : ''}\n`;
    });
    text += `==============================\n`;
    text += `Generated by VapeMix AI\n`;

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recipe.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyToClipboard = () => {
    let text = `${recipe.name}\n`;
    recipe.flavors.forEach(f => {
      text += `${f.name}: ${f.percentage}%${f.notes ? ` [${f.notes}]` : ''}\n`;
    });
    if (recipe.steepingDays) text += `Steep: ${recipe.steepingDays}d\n`;
    
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast here if we had one
    });
  };
  
  return (
    <>
      <Card className="overflow-hidden border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all group">
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle 
              className="text-base font-bold cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
              onClick={onEdit}
            >
              {recipe.name}
            </CardTitle>
            <div className="flex gap-1">
              {recipe.category && (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 border-neutral-200 dark:border-neutral-800">
                  {recipe.category}
                </Badge>
              )}
              {recipe.source === 'ai' && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 font-bold uppercase tracking-wider bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-none">
                  AI
                </Badge>
              )}
              {recipe.source === 'import' && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-none">
                  Imported
                </Badge>
              )}
              {recipe.source === 'manual' && (
                <Badge variant="secondary" className="text-[9px] h-4 px-1.5 font-bold uppercase tracking-wider bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border-none">
                  Manual
                </Badge>
              )}
            </div>
          </div>
          <div className="mt-1">
            <StarRating rating={recipe.rating} onChange={onUpdateRating} size={14} />
          </div>
          <CardDescription className="text-xs mt-1 flex items-center gap-2 flex-wrap">
            <span>{recipe.targetPgRatio}/{100 - recipe.targetPgRatio} PG/VG • {recipe.targetNicMg}mg</span>
            {recipe.steepingDays ? (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500 font-medium bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full">
                <RefreshCw size={10} className="rotate-90" /> {recipe.steepingDays}d steep
              </span>
            ) : null}
            {recipe.mixCount && recipe.mixCount > 0 ? (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-500 font-medium bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded-full">
                <RefreshCw size={10} /> {recipe.mixCount} {recipe.mixCount === 1 ? 'mix' : 'mixes'}
              </span>
            ) : null}
          </CardDescription>
          {recipe.description && (
            <div className="mt-2">
              <button 
                onClick={() => setShowDescription(!showDescription)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-blue-600 dark:text-blue-500 hover:text-blue-700 transition-colors"
              >
                {showDescription ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                Notes
              </button>
              <AnimatePresence>
                {showDescription && (
                  <motion.div
                    key="recipe-description"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400 italic bg-neutral-50 dark:bg-neutral-900/50 p-2 rounded border border-neutral-100 dark:border-neutral-800 leading-relaxed">
                      {recipe.description}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
        <div className="flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity ml-4">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex flex-wrap gap-1.5 mt-2">
            {recipe.flavors.map((f, index) => {
              // f is a RecipeFlavor, invItem is from stash/inventory
              const invItem = inventory.find(inv => isFlavorMatch(inv.name, f.name));
              const inStock = !!invItem;
              // Notes from the stash (inventory)
              const stashNotes = invItem?.notes || '';
              // Notes specifically for this recipe
              const recipeNotes = f.notes || '';
              // Safety warnings from recipe flavor or stash, or compute on the fly as fallback
              const safetyWarnings = f.safetyWarnings || invItem?.safetyWarnings || getSafetyWarnings(f.name);
              const hasSafetyWarnings = safetyWarnings.length > 0;
              const hasAnyNotes = !!recipeNotes || !!stashNotes || hasSafetyWarnings;
              
              const onShoppingList = shoppingList.some(s => isFlavorMatch(s.name, f.name));
              const inOrder = orders.some(o => o.status === 'pending' && o.items.some(oi => isFlavorMatch(oi.name, f.name)));
              
              let badgeClass = "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400";
              let Icon: any = null;

              if (inStock) {
                badgeClass = "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-100 dark:border-green-900";
              } else if (inOrder) {
                badgeClass = "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-purple-100 dark:border-purple-900";
                Icon = Package;
              } else if (onShoppingList) {
                badgeClass = "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900";
                Icon = ShoppingCart;
              } else {
                badgeClass = "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900";
                Icon = X;
              }

              // Use a stable key for expanded state
              const itemKey = `card-f-${f.id || f.name}-${index}`;
              const expansionKey = `expand-${itemKey}`;

              return (
                <div key={itemKey} className="flex flex-col gap-1">
                  <div className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => onEditFlavor?.(f.name)}
                      className="focus:outline-none cursor-pointer hover:opacity-80"
                    >
                      <Badge variant="secondary" className={`text-[10px] font-normal border ${badgeClass} inline-flex items-center gap-1 transition-opacity h-[20px] ${hasAnyNotes ? 'rounded-r-none border-r-0' : ''}`}>
                        {Icon && <Icon className="w-2.5 h-2.5" />}
                        {f.name} ({f.percentage}%)
                      </Badge>
                    </button>
                    {hasAnyNotes && (
                      <button
                        type="button"
                        onClick={() => setExpandedFlavorNotes(prev => ({ ...prev, [expansionKey]: !prev[expansionKey] }))}
                        className={`focus:outline-none cursor-pointer hover:opacity-80 h-[20px] px-1.5 border border-l-0 ${badgeClass} rounded-r-md transition-opacity flex items-center justify-center`}
                        title={hasSafetyWarnings ? "Safety Warning" : "Notes"}
                      >
                        {hasSafetyWarnings ? (
                          <AlertTriangle className="w-3 h-3 text-red-500 fill-red-500/10" />
                        ) : (
                          <StickyNote className="w-3 h-3 opacity-60" />
                        )}
                      </button>
                    )}
                  </div>
                  <AnimatePresence>
                    {hasAnyNotes && expandedFlavorNotes[expansionKey] && (
                      <motion.div
                        key={`${expansionKey}-notes-panel`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="text-[10px] italic bg-neutral-50/50 dark:bg-neutral-900/50 px-2 py-1.5 rounded border border-neutral-100 dark:border-neutral-800/50 max-w-[200px] flex flex-col gap-1.5 shadow-sm">
                          {hasSafetyWarnings && (
                            <div className="flex flex-col p-1.5 bg-red-50 dark:bg-red-950/20 rounded border border-red-100 dark:border-red-900/30">
                              <span className="font-bold not-italic text-[8px] uppercase tracking-tighter text-red-600 dark:text-red-400 mb-0.5 flex items-center gap-1">
                                <AlertTriangle className="w-2 h-2" /> Safety Warning:
                              </span>
                              <p className="text-red-700/80 dark:text-red-400/80 leading-relaxed font-medium">
                                {safetyWarnings.join(" ")}
                              </p>
                            </div>
                          )}
                          {recipeNotes && (
                            <div className="flex flex-col">
                              {(stashNotes) && <span className="font-bold not-italic text-[8px] uppercase tracking-tighter text-neutral-400 dark:text-neutral-500 mb-0.5">Recipe Notes:</span>}
                              <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                                {recipeNotes}
                              </p>
                            </div>
                          )}
                          {stashNotes && (
                            <div className="flex flex-col">
                              {(recipeNotes) && <span className="font-bold not-italic text-[8px] uppercase tracking-tighter text-blue-500/70 mb-0.5">Stash Notes:</span>}
                              <p className="text-blue-600 dark:text-blue-400 leading-relaxed">
                                {stashNotes}
                              </p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
        </div>
        {recipe.lastMixedAt && (
          <p className="text-[10px] text-neutral-400 mt-3 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Last mixed: {new Date(recipe.lastMixedAt).toLocaleDateString()}
          </p>
        )}
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-between items-center">
        <div className="flex gap-1">
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-[10px] text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 gap-1"
            onClick={() => setShowHistory(true)}
          >
            <RefreshCw className="w-3 h-3" /> History
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-[10px] text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 gap-1"
            onClick={handleExportText}
            title="Download as .txt"
          >
            <FileText className="w-3 h-3" /> Export
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-[10px] text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 gap-1"
            onClick={handleCopyToClipboard}
            title="Copy to clipboard"
          >
            <Copy className="w-3 h-3" /> Copy
          </Button>
        </div>
      </CardFooter>
      </Card>
      
      <MixHistoryDialog 
        open={showHistory} 
        onOpenChange={setShowHistory} 
        mixes={mixes}
        inventory={inventory}
        orders={orders}
      />
    </>
  );
}

function FlavorSearchInput({ 
  value, 
  onChange, 
  inventory, 
  shoppingList = [],
  onAddToStash,
  onAddShoppingList
}: { 
  value: string, 
  onChange: (name: string, cost?: number) => void, 
  inventory: InventoryFlavor[],
  shoppingList?: ShoppingItem[],
  onAddToStash: (name: string) => void,
  onAddShoppingList: (name: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value);

  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto';
      textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    setSearch(value);
    // Adjust height after state update and render
    setTimeout(adjustHeight, 0);
  }, [value]);

  const filtered = useMemo(() => {
    if (!search) return [];
    const searchLower = search.toLowerCase();
    
    // In-stock suggestions
    const inStock = inventory.filter(i => 
      i.name.toLowerCase().includes(searchLower)
    );

    // Shopping list suggestions (exclude if already matched in stock)
    const onShoppingList = shoppingList
      .filter(s => 
        s.name.toLowerCase().includes(searchLower) && 
        !inStock.some(i => isFlavorMatch(i.name, s.name))
      )
      .map(s => ({ name: s.name, costPerMl: undefined, isShopping: true }));

    return [
      ...inStock.map(i => ({ ...i, isShopping: false })),
      ...onShoppingList
    ];
  }, [search, inventory, shoppingList]);

  const exactMatch = inventory.find(i => isFlavorMatch(i.name, search)) || 
                     shoppingList.find(i => isFlavorMatch(i.name, search));

  return (
    <div className={`relative ${isOpen ? 'z-50' : 'z-0'}`}>
      <textarea 
        ref={textAreaRef}
        value={search || ''}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange(e.target.value);
          setIsOpen(true);
          adjustHeight();
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 200)}
        placeholder="Search flavors..."
        className="w-full min-h-[36px] p-2 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none leading-tight"
        rows={1}
      />
      {isOpen && (search.length > 0) && (
        <div className="absolute z-50 w-full top-full mt-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md shadow-lg overflow-hidden">
          <ScrollArea className="max-h-[200px]">
            <div className="p-1">
              {filtered.map((item, idx) => (
                <button
                  key={`${item.name}-${idx}`}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-sm flex items-center justify-between"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(item.name, item.costPerMl);
                    setSearch(item.name);
                    setIsOpen(false);
                  }}
                >
                  <span className="flex-1 mr-2 text-neutral-900 dark:text-neutral-100">{item.name}</span>
                  {item.isShopping ? (
                    <Badge variant="secondary" className="text-[9px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-none">On Shopping List</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[9px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-none">In Stock</Badge>
                  )}
                </button>
              ))}
              {!exactMatch && (
                <div className="flex flex-col border-t border-neutral-100 dark:border-neutral-800">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400 flex items-center gap-2"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onAddToStash(search);
                      setIsOpen(false);
                    }}
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Add "{search}" to Stash</span>
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center gap-2 border-t border-neutral-50 dark:border-neutral-800/50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onAddShoppingList(search);
                      setIsOpen(false);
                    }}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>Add "{search}" to Shopping List</span>
                  </button>
                </div>
              )}
              {filtered.length === 0 && exactMatch && (
                <div className="px-3 py-2 text-xs text-neutral-400 italic">
                  Exact match in stock
                </div>
              )}
              {filtered.length === 0 && !exactMatch && (
                <div className="px-3 py-2 text-xs text-neutral-400 italic">
                  No matches found
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

function RecipeEditor({ 
  recipe, 
  recipes, 
  inventory, 
  onSave, 
  onCancel, 
  costs, 
  userSettings,
  shoppingList,
  orders = [],
  onAddInventoryItem,
  onAddShoppingItem,
  setHasUnsavedChanges,
  onStartEditingFlavor
}: { 
  recipe: Recipe | null, 
  recipes: Recipe[], 
  inventory: InventoryFlavor[], 
  onSave: (r: Recipe, m?: Mix) => void, 
  onCancel: () => void, 
  costs: IngredientCost, 
  userSettings: UserSettings,
  shoppingList: ShoppingItem[],
  orders?: Order[],
  onAddInventoryItem: (item: InventoryFlavor) => void,
  onAddShoppingItem: (item: ShoppingItem) => void,
  setHasUnsavedChanges: (has: boolean) => void,
  onStartEditingFlavor: (item: InventoryFlavor, target?: 'stash' | 'shopping', focusField?: string) => void
}) {
  const [flavourIntensity, setFlavourIntensity] = useState(100);
  const [saveAsNewVersion, setSaveAsNewVersion] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isMixingAction, setIsMixingAction] = useState(false);
  const [flavorToDelete, setFlavorToDelete] = useState<string | null>(null);
  const [expandedFlavorNotes, setExpandedFlavorNotes] = useState<Record<string, boolean>>({});
  const isExistingRecipe = useMemo(() => {
    if (!recipe) return false;
    return recipes.some(r => r.id === recipe.id);
  }, [recipe, recipes]);

  const [formData, setFormData] = useState<Recipe>(recipe || {
    id: Math.random().toString(36).substr(2, 9),
    name: '',
    servingMl: userSettings.defaultServingMl,
    targetNicMg: userSettings.defaultTargetNicMg,
    targetPgRatio: userSettings.defaultTargetPgRatio,
    nicBaseMg: userSettings.defaultNicBaseMg,
    nicBaseType: userSettings.defaultNicBaseType,
    steepingDays: 0,
    flavors: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: 'manual'
  });

  const { minPg, maxPg } = useMemo(() => {
    if (!formData.servingMl || formData.servingMl === 0) return { minPg: 0, maxPg: 100 };
    
    const intensityFactor = flavourIntensity / 100;
    const totalFlavorMl = formData.flavors.reduce((acc, f) => acc + (((f.percentage * intensityFactor) / 100) * formData.servingMl), 0);
    const nicotineMl = formData.nicBaseMg > 0 ? (formData.targetNicMg * formData.servingMl) / formData.nicBaseMg : 0;
    
    const minPgMl = totalFlavorMl + (formData.nicBaseType === 'PG' ? nicotineMl : 0);
    const minVgMl = (formData.nicBaseType === 'VG' ? nicotineMl : 0);
    
    const minPgPercent = Math.ceil((minPgMl / formData.servingMl) * 100);
    const minVgPercent = Math.ceil((minVgMl / formData.servingMl) * 100);
    
    return {
      minPg: Math.min(100, minPgPercent),
      maxPg: Math.max(0, 100 - minVgPercent)
    };
  }, [formData.flavors, formData.servingMl, formData.targetNicMg, formData.nicBaseMg, formData.nicBaseType, flavourIntensity]);

  useEffect(() => {
    if (formData.targetPgRatio < minPg) {
      setFormData(prev => ({ ...prev, targetPgRatio: minPg }));
    } else if (formData.targetPgRatio > maxPg) {
      setFormData(prev => ({ ...prev, targetPgRatio: maxPg }));
    }
  }, [minPg, maxPg, formData.targetPgRatio]);

  // Calculate average flavor cost from inventory for fallbacks
  const averageFlavorCost = useMemo(() => {
    const flavorsWithCost = inventory.filter(f => f.costPerMl !== undefined && f.costPerMl > 0);
    if (flavorsWithCost.length === 0) return 0.43; // Default fallback if no data
    const sum = flavorsWithCost.reduce((acc, f) => acc + (f.costPerMl || 0), 0);
    return sum / flavorsWithCost.length;
  }, [inventory]);

  // Check for unsaved changes
  useEffect(() => {
    if (!formData.name && formData.flavors.length === 0) {
      setHasUnsavedChanges(false);
      return;
    }

    // Helper for semantic comparison
    const isRecipeEffectivelyEqual = (r1: Partial<Recipe>, r2: Partial<Recipe>) => {
      const getComparisonData = (r: Partial<Recipe>) => ({
        name: r.name || '',
        category: r.category || 'Other',
        servingMl: r.servingMl,
        targetNicMg: r.targetNicMg,
        targetPgRatio: r.targetPgRatio,
        nicBaseMg: r.nicBaseMg,
        nicBaseType: r.nicBaseType,
        steepingDays: r.steepingDays || 0,
        description: r.description || '',
        flavors: r.flavors?.map(f => ({
          name: f.name,
          percentage: f.percentage,
          notes: f.notes || ''
        }))
      });

      return JSON.stringify(getComparisonData(r1)) === JSON.stringify(getComparisonData(r2));
    };

    const base = isExistingRecipe ? recipe! : {
      id: formData.id,
      name: '',
      servingMl: userSettings.defaultServingMl,
      targetNicMg: userSettings.defaultTargetNicMg,
      targetPgRatio: userSettings.defaultTargetPgRatio,
      nicBaseMg: userSettings.defaultNicBaseMg,
      nicBaseType: userSettings.defaultNicBaseType,
      flavors: [],
      createdAt: formData.createdAt,
      updatedAt: formData.updatedAt
    };

    // If it's a new recipe, we only consider it "changed" if name or flavors are added
    if (!isExistingRecipe) {
      const hasContent = formData.name !== '' || formData.flavors.length > 0;
      setHasUnsavedChanges(hasContent);
      return;
    }

    const hasChanges = !isRecipeEffectivelyEqual(formData, base);
    setHasUnsavedChanges(hasChanges);

    if (hasChanges) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }, [formData, recipe, userSettings, setHasUnsavedChanges]);

  // Sync flavor costs from stash when inventory changes
  useEffect(() => {
    setFormData(prev => {
      let changed = false;
      const updatedFlavors = prev.flavors.map(f => {
        const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
        // If stash has a valid cost and it differs from recipe's recorded cost, update it
        if (stashFlavor && stashFlavor.costPerMl !== undefined && stashFlavor.costPerMl !== f.costPerMl) {
          changed = true;
          return { ...f, costPerMl: stashFlavor.costPerMl };
        }
        return f;
      });

      if (changed) {
        return { ...prev, flavors: updatedFlavors };
      }
      return prev;
    });
  }, [inventory]);

  // Listen for external save trigger (from UnsavedChangesDialog)
  useEffect(() => {
    const handleExternalSave = (e: any) => {
      const { saveAsNew } = e.detail;
      setSaveAsNewVersion(saveAsNew);
      // We need to wait for state update or just pass it directly
      // Let's just call handleSave with the right params
      if (saveAsNew) {
        const newName = getNextVersionName(formData.name, recipes);
        onSave({
          ...formData,
          id: Math.random().toString(36).substr(2, 9),
          name: newName,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      } else {
        onSave({
          ...formData,
          updatedAt: Date.now()
        });
      }
      setHasUnsavedChanges(false);
    };
    window.addEventListener('trigger-recipe-save', handleExternalSave);
    return () => window.removeEventListener('trigger-recipe-save', handleExternalSave);
  }, [formData, recipes, onSave, setHasUnsavedChanges]);

  useEffect(() => {
    setFlavourIntensity(100);
    setSaveAsNewVersion(false);
    const baseRecipe = recipe || {
      id: Math.random().toString(36).substr(2, 9),
      name: '',
      servingMl: userSettings.defaultServingMl,
      targetNicMg: userSettings.defaultTargetNicMg,
      targetPgRatio: userSettings.defaultTargetPgRatio,
      nicBaseMg: userSettings.defaultNicBaseMg,
      nicBaseType: userSettings.defaultNicBaseType,
      flavors: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Populate costs from inventory if missing or zero and ensure stable IDs
    const flavorsWithCosts = baseRecipe.flavors.map((f, idx) => {
      const stableId = f.id || `f-${f.name}-${idx}`;
      if (f.costPerMl === undefined || f.costPerMl === 0) {
        const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
        if (stashFlavor?.costPerMl) {
          return { ...f, id: stableId, costPerMl: stashFlavor.costPerMl };
        }
        return { ...f, id: stableId, costPerMl: averageFlavorCost };
      }
      return { ...f, id: stableId };
    });

    setFormData({ ...baseRecipe, flavors: flavorsWithCosts, source: baseRecipe.source || 'manual' });
  }, [recipe]);

  const results = useMemo(() => {
    const intensityFactor = flavourIntensity / 100;
    const recipeWithStashCosts = {
      ...formData,
      flavors: formData.flavors.map(f => {
        const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
        return {
          ...f,
          percentage: f.percentage * intensityFactor,
          costPerMl: stashFlavor?.costPerMl || f.costPerMl || averageFlavorCost
        };
      })
    };
    return calculateRecipe(recipeWithStashCosts, costs, { 
      pg: userSettings.pgDensity, 
      vg: userSettings.vgDensity 
    });
  }, [formData, costs, inventory, flavourIntensity, userSettings]);

  const totalFlavorVol = useMemo(() => 
    results.flavorResults.reduce((acc, f) => acc + f.ml, 0), 
  [results.flavorResults]);

  const totalFlavorPct = useMemo(() => 
    results.flavorResults.reduce((acc, f) => acc + f.percentage, 0), 
  [results.flavorResults]);

  const handleSave = (isMixing = false) => {
    if (!formData.name) return;

    const updatedMixCount = isMixing ? (formData.mixCount || 0) + 1 : (formData.mixCount || 0);

    setHasUnsavedChanges(false);

    // Calculate the final ID and name once to ensure consistency
    let finalRecipeId = recipe?.id || formData.id;
    let finalRecipeName = formData.name;
    
    if (isExistingRecipe && saveAsNewVersion) {
      finalRecipeId = Math.random().toString(36).substr(2, 9);
      finalRecipeName = getNextVersionName(formData.name, recipes);
    }

    if (isMixing) {
      const mixRecord: Mix = {
        id: Math.random().toString(36).substr(2, 9),
        recipeId: finalRecipeId,
        recipeName: finalRecipeName,
        mixedAt: Date.now(),
        totalVolume: results.totalMl,
        targetPgRatio: formData.targetPgRatio,
        targetNicMg: formData.targetNicMg,
        steepingDays: formData.steepingDays,
        flavorIntensity: flavourIntensity,
        flavors: formData.flavors.map(f => {
          const result = results.flavorResults.find(r => r.id === f.id);
          return {
            id: f.id,
            name: f.name,
            originalName: f.originalName,
            percentage: result?.percentage ?? f.percentage,
            ml: result?.ml || 0,
            isSubstitution: f.isSubstitution,
            notes: f.notes
          };
        }),
        uid: '' // Will be set in App.tsx
      };

      // When saving, we keep the flavors as they are in the editor (including substitutions)
      const recipeToSave: Recipe = { 
        ...formData, 
        id: finalRecipeId, 
        name: finalRecipeName,
        updatedAt: Date.now(),
        lastMixedAt: isMixing ? Date.now() : formData.lastMixedAt,
        mixCount: (isExistingRecipe && saveAsNewVersion) ? (isMixing ? 1 : 0) : updatedMixCount
      };

      // When saving AND mixing, we pass the mix record to onSave for better atomicity 
      // and to handle duplicate conflicts correctly
      onSave(recipeToSave, mixRecord);
    } else {
      const recipeToSave: Recipe = { 
        ...formData, 
        id: finalRecipeId, 
        name: finalRecipeName,
        updatedAt: Date.now(),
        lastMixedAt: isMixing ? Date.now() : formData.lastMixedAt,
        mixCount: (isExistingRecipe && saveAsNewVersion) ? (isMixing ? 1 : 0) : updatedMixCount
      };
      onSave(recipeToSave);
    }
    
    setShowConfirm(false);
  };

  const addFlavor = () => {
    setFormData({
      ...formData,
      flavors: [...formData.flavors, { id: Math.random().toString(36).substr(2, 9), name: '', percentage: 0 }]
    });
  };

  const updateFlavor = (id: string, updates: Partial<Flavor>) => {
    setFormData(prev => ({
      ...prev,
      flavors: prev.flavors.map(f => {
        if (f.id === id) {
          const updated = { ...f, ...updates };
          // If name changed, check for safety warnings and cost
          if (updates.name !== undefined) {
            // Check safety warnings
            updated.safetyWarnings = getSafetyWarnings(updates.name);

            // Try to find cost in stash if not provided
            if (updates.costPerMl === undefined) {
              const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, updates.name || ''));
              if (stashFlavor?.costPerMl) {
                updated.costPerMl = stashFlavor.costPerMl;
              }
            }
          }
          return updated;
        }
        return f;
      })
    }));
  };

  const removeFlavor = (id: string) => {
    setFormData({
      ...formData,
      flavors: formData.flavors.filter(f => f.id !== id)
    });
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">{isExistingRecipe ? 'Edit Recipe' : 'New Recipe'}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => {
            if (isExistingRecipe) {
              setIsMixingAction(false);
              setShowConfirm(true);
            } else {
              handleSave(false);
            }
          }} disabled={!formData.name} className={!formData.name ? "opacity-50 cursor-not-allowed" : ""}>
            <Save className="w-4 h-4 mr-2" /> {isExistingRecipe ? (saveAsNewVersion ? 'Save New Version' : 'Update Recipe') : 'Save Recipe'}
          </Button>
        </div>
      </div>

      {isExistingRecipe && (
        <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-0.5 text-left">
              <p className="text-sm font-bold text-blue-900 dark:text-blue-300">Save Options</p>
              <p className="text-xs text-blue-700 dark:text-blue-400">Choose whether to overwrite the current recipe or create a new version.</p>
            </div>
            <div className="flex items-center gap-2 bg-white dark:bg-neutral-900 p-1 rounded-lg border border-blue-200 dark:border-blue-900 shadow-sm">
              <Button 
                variant={!saveAsNewVersion ? "default" : "ghost"} 
                size="sm" 
                className={`h-8 px-3 text-xs ${!saveAsNewVersion ? 'bg-blue-600 hover:bg-blue-700' : 'text-neutral-500 dark:text-neutral-400'}`}
                onClick={() => setSaveAsNewVersion(false)}
              >
                Overwrite
              </Button>
              <Button 
                variant={saveAsNewVersion ? "default" : "ghost"} 
                size="sm" 
                className={`h-8 px-3 text-xs ${saveAsNewVersion ? 'bg-blue-600 hover:bg-blue-700' : 'text-neutral-500 dark:text-neutral-400'}`}
                onClick={() => setSaveAsNewVersion(true)}
              >
                New Version
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Base Settings</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="flex items-center gap-1">
                    Recipe Name
                    <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <Input 
                    id="name" 
                    value={formData.name} 
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Blue Raspberry Slush"
                    className={`dark:bg-neutral-900 transition-colors ${!formData.name ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/10' : ''}`}
                  />
                  {!formData.name && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-500 font-medium flex items-center gap-1 italic">
                      <AlertCircle className="w-2.5 h-2.5" /> A name is required to save this recipe
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select 
                    value={formData.category || 'Other'}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                  >
                    <SelectTrigger className="h-10 w-full dark:bg-neutral-900">
                      <SelectValue placeholder="Category">
                        {formData.category || 'Other'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 text-left">
                  <Label>Rating</Label>
                  <div className="h-10 flex items-center">
                    <StarRating 
                      rating={formData.rating} 
                      onChange={(rating) => setFormData({ ...formData, rating })} 
                      size={20} 
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="source">Source</Label>
                  <Select 
                    value={formData.source || 'manual'}
                    onValueChange={(value: 'manual' | 'import' | 'ai') => setFormData({ ...formData, source: value })}
                  >
                    <SelectTrigger className="h-10 w-full dark:bg-neutral-900">
                      <SelectValue placeholder="Source">
                        {SOURCE_OPTIONS[formData.source || 'manual']}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="import">Imported</SelectItem>
                      <SelectItem value="ai">AI Generated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="serving">Serving Size (ml)</Label>
                  <Input 
                    id="serving" 
                    type="number" 
                    value={formData.servingMl || ''} 
                    onChange={(e) => setFormData({ ...formData, servingMl: e.target.value === '' ? 0 : Number(e.target.value) })}
                    className="dark:bg-neutral-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nic">Target Nic (mg)</Label>
                  <Input 
                    id="nic" 
                    type="number" 
                    value={formData.targetNicMg === 0 || formData.targetNicMg === undefined ? '' : formData.targetNicMg} 
                    onChange={(e) => setFormData({ ...formData, targetNicMg: e.target.value === '' ? 0 : Number(e.target.value) })}
                    className="dark:bg-neutral-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="steeping">Steeping (Days)</Label>
                  <Input 
                    id="steeping" 
                    type="number" 
                    value={formData.steepingDays === 0 || formData.steepingDays === undefined ? '' : formData.steepingDays} 
                    onChange={(e) => setFormData({ ...formData, steepingDays: e.target.value === '' ? 0 : Number(e.target.value) })}
                    placeholder="e.g., 7"
                    className="dark:bg-neutral-900"
                  />
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <Label>PG/VG Ratio</Label>
                  <span className="text-sm font-mono">{formData.targetPgRatio}/{100 - formData.targetPgRatio}</span>
                </div>
                <Slider 
                  value={[formData.targetPgRatio]} 
                  min={0} 
                  max={100} 
                  step={1} 
                  onValueChange={(val) => {
                    const v = Array.isArray(val) ? val[0] : val;
                    
                    // Target 5% increments but allow minPg and maxPg boundaries
                    const snappedTo5 = Math.round(v / 5) * 5;
                    const boundedSnapped = Math.max(minPg, Math.min(maxPg, snappedTo5));
                    
                    if (v <= minPg) {
                      setFormData({ ...formData, targetPgRatio: minPg });
                    } else if (v >= maxPg) {
                      setFormData({ ...formData, targetPgRatio: maxPg });
                    } else {
                      setFormData({ ...formData, targetPgRatio: boundedSnapped });
                    }
                  }}
                />
                {(minPg > 0 || maxPg < 100) && (
                  <p className="text-[10px] text-amber-500 font-medium">
                    Limits: {minPg}% PG min / {100 - maxPg}% VG min due to ingredients
                  </p>
                )}
              </div>

              <div className="space-y-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                <div className="flex justify-between items-center">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                       Flavour Intensity
                       <TooltipProvider>
                         <Tooltip>
                           <TooltipTrigger>
                             <Info className="w-3 h-3 text-neutral-400 cursor-help" />
                           </TooltipTrigger>
                           <TooltipContent>
                             <p className="text-[10px]">Scales all flavor percentages for this mix session.</p>
                           </TooltipContent>
                         </Tooltip>
                       </TooltipProvider>
                    </Label>
                  </div>
                  <span className={`text-sm font-bold ${flavourIntensity === 100 ? 'text-neutral-400' : 'text-blue-500'}`}>
                    {flavourIntensity}%
                  </span>
                </div>
                <Slider 
                  value={[flavourIntensity <= 100 ? (flavourIntensity - 50) / 5 : 10 + (flavourIntensity - 100) / 10]} 
                  min={0} 
                  max={20} 
                  step={1} 
                  onValueChange={(val) => {
                    const x = Array.isArray(val) ? val[0] : val;
                    const p = x <= 10 ? 50 + (x * 5) : 100 + ((x - 10) * 10);
                    setFlavourIntensity(p);
                  }}
                />
                <div className="flex justify-between text-[10px] text-neutral-400 font-medium">
                  <span>Mellow (50%)</span>
                  <span>Normal (100%)</span>
                  <span>Strong (200%)</span>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                <Label htmlFor="description">Notes / Description</Label>
                <textarea 
                  id="description"
                  value={formData.description || ''} 
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Add details about this recipe, flavor profile, or special instructions..."
                  className="w-full min-h-[80px] p-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-visible">
            <CardHeader className="p-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{flavors(true)}</CardTitle>
              <Button variant="ghost" size="sm" onClick={addFlavor} className="h-8 gap-1 dark:text-neutral-300">
                <Plus className="w-4 h-4" /> Add
              </Button>
            </CardHeader>
            <TooltipProvider>
              <CardContent className="p-4 pt-0 space-y-3">
              <div className="grid grid-cols-[1fr_55px_65px_40px_40px] gap-2 mb-1 px-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Name</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 text-center">%</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 text-center">Cost/ml</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 text-center">Notes</span>
                <span></span>
              </div>
              {formData.flavors.map((flavor, index) => {
                const isInStock = inventory.some(inv => isFlavorMatch(inv.name, flavor.name));
                const isOnShoppingList = shoppingList.some(item => isFlavorMatch(item.name, flavor.name));
                const isInOrder = orders.some(o => o.status === 'pending' && o.items.some(oi => isFlavorMatch(oi.name, flavor.name)));
                const substitutes = !isInStock ? findSubstitutes(flavor.name, inventory) : [];
                const flavorKey = `edit-${flavor.id || flavor.name}-${index}`;
                const expansionKey = `notes-${flavorKey}`;
                
                return (
                  <div key={flavorKey} className="space-y-2">
                    <div className="grid grid-cols-[1fr_55px_65px_40px_40px] gap-2 items-start px-1">
                      <div className="relative">
                        <FlavorSearchInput 
                          value={flavor.name || ''} 
                          inventory={inventory}
                          shoppingList={shoppingList}
                          onChange={(name, cost) => {
                            const updates: Partial<Flavor> = { name };
                            if (cost !== undefined) updates.costPerMl = cost;
                            // If we are changing name, reset substitution status
                            updates.isSubstitution = false;
                            updates.originalName = undefined;
                            updateFlavor(flavor.id, updates);
                          }}
                          onAddShoppingList={(name) => {
                            if (!shoppingList.some(i => isFlavorMatch(i.name, name))) {
                              const newFlavor = { name };
                              onStartEditingFlavor(newFlavor, 'shopping');
                            }
                            updateFlavor(flavor.id, { name, isSubstitution: false, originalName: undefined });
                          }}
                          onAddToStash={(name) => {
                            if (!inventory.some(i => isFlavorMatch(i.name, name))) {
                              const newFlavor = { name };
                              onStartEditingFlavor(newFlavor, 'stash');
                            }
                            updateFlavor(flavor.id, { name, isSubstitution: false, originalName: undefined });
                          }}
                        />
                      </div>
                      <Input 
                        type="number" 
                        placeholder="%" 
                        value={flavor.percentage || ''} 
                        onChange={(e) => updateFlavor(flavor.id, { percentage: e.target.value === '' ? 0 : Number(e.target.value) })}
                        className="h-9 text-center dark:bg-neutral-900 px-1"
                      />
                      <Tooltip>
                        <TooltipTrigger
                          onClick={() => {
                            const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, flavor.name));
                            if (stashFlavor) {
                              onStartEditingFlavor(stashFlavor, undefined, 'cost');
                            } else {
                              // If not in stash, offer to add it
                              onStartEditingFlavor({ name: flavor.name }, 'stash', 'cost');
                            }
                          }}
                          className="w-full h-9 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-md flex flex-col items-center justify-center cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors px-1"
                        >
                          <span className="font-mono font-medium text-[11px] truncate text-neutral-600 dark:text-neutral-300">
                            {flavor.costPerMl !== undefined ? `$${flavor.costPerMl.toFixed(2)}` : 'N/A'}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Click to edit flavor details in your stash</p>
                        </TooltipContent>
                      </Tooltip>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className={`mx-auto h-9 w-9 shrink-0 ${expandedFlavorNotes[expansionKey] ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-neutral-400 dark:text-neutral-500'}`}
                        onClick={() => setExpandedFlavorNotes(prev => ({ ...prev, [expansionKey]: !prev[expansionKey] }))}
                      >
                        <StickyNote className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="mx-auto h-9 w-9 text-neutral-400 dark:text-neutral-500 shrink-0" 
                        onClick={() => setFlavorToDelete(flavor.id)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <AnimatePresence>
                      {expandedFlavorNotes[expansionKey] && (
                        <motion.div
                          key={`${expansionKey}-panel`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden px-1 grid gap-2 mb-2"
                        >
                          <div className="space-y-1">
                            <Label className="text-[9px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-bold">Recipe Note</Label>
                            <textarea
                              value={flavor.notes || ''}
                              onChange={(e) => updateFlavor(flavor.id, { notes: e.target.value })}
                              placeholder="Specific notes for this flavor in this recipe..."
                              className="w-full min-h-[60px] p-2 text-xs rounded-md border border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/30 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all resize-none"
                            />
                          </div>
                          {inventory.find(inv => isFlavorMatch(inv.name, flavor.name))?.notes && (
                            <div className="space-y-1 p-2 rounded-md bg-blue-50/30 dark:bg-blue-900/10 border border-blue-100/30 dark:border-blue-900/20">
                              <Label className="text-[9px] uppercase tracking-wider text-blue-500/70 font-bold flex items-center gap-1">
                                <StickyNote className="w-2 h-2" /> Stash Note Reference
                              </Label>
                              <p className="text-[11px] text-neutral-600 dark:text-neutral-400 italic leading-relaxed">
                                {inventory.find(inv => isFlavorMatch(inv.name, flavor.name))?.notes}
                              </p>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {flavor.name && (
                      <div className="flex flex-col gap-1 px-1">
                        <div className="flex items-center gap-2">
                          {isInStock ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-[9px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-none flex items-center gap-1">
                                {flavor.isSubstitution ? 'Substituted' : 'In Stash'}
                              </Badge>
                              {flavor.isSubstitution && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-5 text-[9px] px-1.5 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 gap-1"
                                  onClick={() => {
                                    if (flavor.originalName) {
                                      updateFlavor(flavor.id, { 
                                        name: flavor.originalName, 
                                        isSubstitution: false, 
                                        originalName: undefined 
                                      });
                                    }
                                  }}
                                >
                                  Revert to {flavor.originalName}
                                </Button>
                              )}
                              {!isOnShoppingList && (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-5 text-[9px] px-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 gap-1"
                                  onClick={() => {
                                    onAddShoppingItem({
                                      id: Math.random().toString(36).substr(2, 9),
                                      name: flavor.name,
                                      addedAt: Date.now()
                                    });
                                  }}
                                >
                                  <ShoppingCart className="w-2.5 h-2.5" /> Running Low?
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              {isInOrder ? (
                                <Badge variant="secondary" className="text-[9px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-none flex items-center gap-1">
                                  <Package className="w-2.5 h-2.5" /> On Order
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[9px] bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-none flex items-center gap-1">
                                  <X className="w-2.5 h-2.5" /> Out of Stock
                                </Badge>
                              )}
                              {!isOnShoppingList ? (
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-5 text-[9px] px-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 gap-1"
                                  onClick={() => {
                                    onAddShoppingItem({
                                      id: Math.random().toString(36).substr(2, 9),
                                      name: flavor.name,
                                      addedAt: Date.now()
                                    });
                                  }}
                                >
                                  <ShoppingCart className="w-2.5 h-2.5" /> Add to Shopping List
                                </Button>
                              ) : (
                                <Badge variant="secondary" className="text-[9px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-none flex items-center gap-1">
                                  <ShoppingCart className="w-2.5 h-2.5" /> On Shopping List
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        
                        {!isInStock && substitutes.length > 0 && (
                          <div className="mt-1 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 space-y-1.5 text-left">
                            <p className="text-[10px] font-medium text-amber-800 dark:text-amber-400 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" /> Similar flavors in stash:
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {substitutes.map((sub, sIdx) => (
                                <Button
                                  key={`${sub.flavor.name}-${sIdx}`}
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-[9px] bg-white border-amber-200 text-amber-700 hover:bg-amber-100 hover:border-amber-300 px-2 py-0"
                                  onClick={() => {
                                    const updates: Partial<Flavor> = {
                                      name: sub.flavor.name,
                                      costPerMl: sub.flavor.costPerMl,
                                      isSubstitution: true,
                                      originalName: flavor.originalName || flavor.name
                                    };
                                    if (sub.multiplier !== 1) {
                                      updates.percentage = Number((flavor.percentage * sub.multiplier).toFixed(2));
                                    }
                                    updateFlavor(flavor.id, updates);
                                  }}
                                >
                                  Use {sub.flavor.name} {sub.multiplier !== 1 ? `(${sub.multiplier}x qty)` : ''}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {formData.flavors.length === 0 && (
                <p className="text-center py-4 text-xs text-neutral-400 italic">No {flavors()} added yet.</p>
              )}
            </CardContent>
          </TooltipProvider>
        </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-neutral-900 text-white border-none shadow-xl">
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-neutral-400">Mixing Results</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <ResultItem 
                  label="Nicotine" 
                  ml={results.nicotineMl} 
                  grams={results.nicotineGrams} 
                  color="text-red-400" 
                  preference={userSettings.mixingPreference} 
                  cost={results.nicotineMl * costs.nicCostPerMl}
                />
                <ResultItem 
                  label="PG" 
                  ml={results.pgMl} 
                  grams={results.pgGrams} 
                  color="text-blue-400" 
                  preference={userSettings.mixingPreference} 
                  cost={results.pgMl * costs.pgCostPerMl}
                />
                <ResultItem 
                  label="VG" 
                  ml={results.vgMl} 
                  grams={results.vgGrams} 
                  color="text-green-400" 
                  preference={userSettings.mixingPreference} 
                  cost={results.vgMl * costs.vgCostPerMl}
                />
                <ResultItem 
                  label="Total" 
                  ml={results.totalMl} 
                  grams={results.totalGrams} 
                  color="text-white" 
                  bold 
                  preference={userSettings.mixingPreference} 
                  cost={results.totalCost}
                />
              </div>
              
              <Separator className="bg-neutral-800" />
              
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                  {flavor(true)} Breakdown {flavourIntensity !== 100 && <span className="text-blue-500 lowercase">({flavourIntensity}% scaled)</span>}
                </p>
                {results.flavorResults.map((f, index) => {
                  const itemKey = `res-${f.id || f.name}-${index}`;
                  const expansionKey = `expand-${itemKey}`;
                  const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
                  const isInStock = !!stashFlavor;
                  const isInOrder = orders.some(o => o.status === 'pending' && o.items.some(oi => isFlavorMatch(oi.name, f.name)));
                  const onShoppingList = shoppingList.some(s => isFlavorMatch(s.name, f.name));
                  
                  const stockVolume = stashFlavor?.volumeMl;
                  const isInsufficientStock = stockVolume !== undefined && stockVolume < f.ml;
                  const isCompletelyOut = stockVolume === 0;

                  const stashNotes = stashFlavor?.notes;
                  const recipeNotes = formData.flavors.find(fl => fl.id === f.id)?.notes;
                  const safetyWarnings = formData.flavors.find(fl => fl.id === f.id)?.safetyWarnings || stashFlavor?.safetyWarnings || getSafetyWarnings(f.name);
                  const hasSafetyWarnings = safetyWarnings.length > 0;
                  const hasAnyNotes = !!stashNotes || !!recipeNotes || hasSafetyWarnings;
                  
                  return (
                    <div key={itemKey} className="flex flex-col gap-1 border-b border-neutral-800/50 pb-2 last:border-0 last:pb-0">
                      <div className="flex justify-between items-start text-sm">
                        <div className="flex-1 mr-4 space-y-1">
                        <div 
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
                            if (stashFlavor) {
                              onStartEditingFlavor(stashFlavor);
                            } else {
                              onStartEditingFlavor({ name: f.name }, 'stash');
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
                              if (stashFlavor) {
                                onStartEditingFlavor(stashFlavor);
                              } else {
                                onStartEditingFlavor({ name: f.name }, 'stash');
                              }
                            }
                          }}
                          className="flex flex-col items-start gap-1 group/item text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/50 rounded-sm"
                          title="Click to edit flavor details in stash"
                        >
                            <div className="flex items-center gap-2">
                              <span className="text-neutral-300 leading-tight group-hover/item:text-blue-400 transition-colors">
                                {f.name || `Unnamed ${flavor()}`}
                                <span className="text-[10px] text-neutral-500 ml-1">({f.percentage.toFixed(2)}%)</span>
                              </span>
                              {isInOrder && !isInStock && (
                                <Badge variant="outline" className="h-3.5 px-1 text-[8px] bg-purple-500/20 text-purple-400 border-purple-500/30 border-none font-bold uppercase tracking-tighter">
                                  <Package className="w-2 h-2 mr-0.5" /> On Order
                                </Badge>
                              )}
                              {isInsufficientStock && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className={`h-3.5 px-1 text-[8px] border-none font-bold uppercase tracking-tighter ${isCompletelyOut ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-amber-500/20 text-amber-500'}`}>
                                        <AlertCircle className="w-2 h-2 mr-0.5" /> 
                                        {isCompletelyOut ? 'Out of Stock' : 'Low Stock'}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="bg-neutral-900 border-neutral-700 text-white">
                                      <p className="text-[10px]">Stash: {stockVolume?.toFixed(2)}ml | Required: {f.ml.toFixed(2)}ml</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {hasSafetyWarnings && (
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                              )}
                            </div>
                            {getPotencyWarning(f.name, f.percentage) && (
                              <div className="flex items-start gap-1 p-1 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-500 mt-1 max-w-full">
                                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                                <span className="leading-tight">{getPotencyWarning(f.name, f.percentage)}</span>
                              </div>
                            )}
                          </div>
                          {hasAnyNotes && (
                            <button 
                              type="button"
                              onClick={() => setExpandedFlavorNotes(prev => ({ ...prev, [expansionKey]: !prev[expansionKey] }))}
                              className={`transition-colors flex items-center gap-1 text-[10px] ${expandedFlavorNotes[expansionKey] ? 'text-blue-400' : 'text-neutral-600 hover:text-neutral-400'}`}
                            >
                              <StickyNote className="w-3 h-3" />
                              <span>{expandedFlavorNotes[expansionKey] ? 'Hide Notes' : 'View Notes'}</span>
                            </button>
                          )}
                        </div>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
                            if (stashFlavor) {
                              onStartEditingFlavor(stashFlavor, undefined, 'cost');
                            } else {
                              onStartEditingFlavor({ name: f.name }, 'stash', 'cost');
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              const stashFlavor = inventory.find(inv => isFlavorMatch(inv.name, f.name));
                              if (stashFlavor) {
                                onStartEditingFlavor(stashFlavor, undefined, 'cost');
                              } else {
                                onStartEditingFlavor({ name: f.name }, 'stash', 'cost');
                              }
                            }
                          }}
                          className="text-right group/cost cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/50 rounded-sm"
                          title="Click to edit flavor cost in stash"
                        >
                          {userSettings.mixingPreference === 'volume' ? (
                            <div className="flex flex-col items-end">
                              <div className="flex items-center gap-1.5">
                                {!onShoppingList && isInsufficientStock && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button 
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onAddShoppingItem({ 
                                              id: Math.random().toString(36).substr(2, 9),
                                              name: f.name,
                                              addedAt: Date.now(),
                                              uid: '' 
                                            });
                                          }}
                                          className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer p-0.5"
                                        >
                                          <ShoppingCart className="w-3.5 h-3.5" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="bg-neutral-900 border-neutral-700 text-white">
                                        <p className="text-[10px]">Add to shopping list</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                <div className={`font-mono font-bold group-hover/cost:text-blue-400 transition-colors ${isInsufficientStock ? (isCompletelyOut ? 'text-red-500' : 'text-amber-500') : 'text-white'}`}>
                                  {f.ml.toFixed(2)}ml
                                </div>
                              </div>
                              <div className="text-[10px] text-neutral-500 leading-none">
                                {f.grams.toFixed(2)}g • ${((f.ml * (stashFlavor?.costPerMl || formData.flavors.find(fl => fl.id === f.id)?.costPerMl || averageFlavorCost))).toFixed(2)}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end">
                              <div className="flex items-center gap-1.5">
                                {!onShoppingList && isInsufficientStock && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button 
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onAddShoppingItem({ 
                                              id: Math.random().toString(36).substr(2, 9),
                                              name: f.name,
                                              addedAt: Date.now(),
                                              uid: '' 
                                            });
                                          }}
                                          className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer p-0.5"
                                        >
                                          <ShoppingCart className="w-3.5 h-3.5" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="bg-neutral-900 border-neutral-700 text-white">
                                        <p className="text-[10px]">Add to shopping list</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                <div className={`font-mono font-bold group-hover/cost:text-blue-400 transition-colors ${isInsufficientStock ? (isCompletelyOut ? 'text-red-500' : 'text-amber-500') : 'text-white'}`}>
                                  {f.grams.toFixed(2)}g
                                </div>
                              </div>
                              <div className="text-[10px] text-neutral-500 leading-none">
                                {f.ml.toFixed(2)}ml • ${((f.ml * (stashFlavor?.costPerMl || formData.flavors.find(fl => fl.id === f.id)?.costPerMl || averageFlavorCost))).toFixed(2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <AnimatePresence>
                        {hasAnyNotes && expandedFlavorNotes[expansionKey] && (
                          <motion.div
                            key={`${expansionKey}-panel`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="text-[10px] italic bg-white/5 dark:bg-neutral-800/30 px-2 py-1.5 rounded border border-white/10 dark:border-neutral-700/30 flex flex-col gap-1.5 mt-1">
                              {hasSafetyWarnings && (
                                <div className="flex flex-col p-1.5 bg-red-500/10 rounded border border-red-500/20">
                                  <span className="font-bold not-italic text-[8px] uppercase tracking-tighter text-red-400 mb-0.5 flex items-center gap-1">
                                    <AlertTriangle className="w-2 h-2 text-red-500" /> Potential Hazard:
                                  </span>
                                  <p className="text-red-300/80 leading-relaxed font-medium italic">
                                    {safetyWarnings.join(" ")}
                                  </p>
                                </div>
                              )}
                              {recipeNotes && (
                                <div className="flex flex-col">
                                  {stashNotes && <span className="font-bold not-italic text-[8px] uppercase tracking-tighter text-neutral-500 mb-0.5">Recipe Note:</span>}
                                  <p className="text-neutral-400 leading-relaxed">{recipeNotes}</p>
                                </div>
                              )}
                              {stashNotes && (
                                <div className="flex flex-col">
                                  {recipeNotes && <span className="font-bold not-italic text-[8px] uppercase tracking-tighter text-blue-400/70 mb-0.5">Stash Note:</span>}
                                  <p className="text-blue-300/80 leading-relaxed font-medium">{stashNotes}</p>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
                {formData.flavors.length > 1 && (
                  <div className="pt-2 mt-2 border-t border-neutral-800 flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                    <span>Total Flavor</span>
                    <div className="text-right">
                      <span className="text-neutral-300">{totalFlavorVol.toFixed(2)}ml</span>
                      <span className="mx-1.5 opacity-30">•</span>
                      <span className="text-neutral-300">{totalFlavorPct.toFixed(2)}%</span>
                    </div>
                  </div>
                )}
              </div>

              <Separator className="bg-neutral-800" />

              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1 text-neutral-400">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-sm">Estimated Cost</span>
                </div>
                <span className="text-lg font-bold">${results.totalCost.toFixed(2)}</span>
              </div>

              <Button 
                className={`w-full gap-2 transition-all ${!formData.name ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                disabled={!formData.name}
                onClick={() => {
                  if (isExistingRecipe) {
                    setIsMixingAction(true);
                    setShowConfirm(true);
                  } else {
                    handleSave(true);
                  }
                }}
              >
                <RefreshCw className={`w-4 h-4 ${!formData.name ? 'opacity-30' : ''}`} />
                {formData.name ? 'Record Mix & Save' : 'Enter Recipe Name to Save'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-neutral-500">Nicotine Base</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Base Strength (mg)</Label>
                  <Input 
                    type="number" 
                    value={formData.nicBaseMg || ''} 
                    onChange={(e) => setFormData({ ...formData, nicBaseMg: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Base Type</Label>
                  <Select 
                    value={formData.nicBaseType || 'PG'} 
                    onValueChange={(val: 'PG' | 'VG') => setFormData({ ...formData, nicBaseType: val })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PG">PG</SelectItem>
                      <SelectItem value="VG">VG</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isMixingAction ? 'Confirm Mixing' : 'Confirm Save'}</DialogTitle>
            <DialogDescription>
              {isMixingAction 
                ? "Record this mix and update your inventory levels?" 
                : (saveAsNewVersion 
                  ? "Are you sure you want to create a new recipe version?" 
                  : "Are you sure you want to overwrite the existing recipe?")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={() => {
              setShowConfirm(false);
              handleSave(isMixingAction);
            }}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!flavorToDelete} onOpenChange={(open) => !open && setFlavorToDelete(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Remove Flavor?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{formData.flavors.find(f => f.id === flavorToDelete)?.name || 'this flavor'}</strong> from your recipe? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setFlavorToDelete(null)}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                if (flavorToDelete) {
                  removeFlavor(flavorToDelete);
                  setFlavorToDelete(null);
                }
              }}
            >
              Remove Flavor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResultItem({ label, ml, grams, color, bold, preference = 'weight', cost }: { label: string, ml: number, grams: number, color: string, bold?: boolean, preference?: 'weight' | 'volume', cost?: number }) {
  const drops = Math.round(ml * 38);
  const isWeight = preference === 'weight';
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className={`text-[10px] font-semibold uppercase tracking-widest ${color} opacity-90`}>{label}</p>
        {cost !== undefined && (
          <span className="text-[9px] text-neutral-500 font-mono">${cost.toFixed(2)}</span>
        )}
      </div>
      <div className="flex flex-col">
        <span className={`text-xl font-bold font-mono leading-none ${bold ? 'text-white' : 'text-neutral-100'}`}>
          {isWeight ? (
            <>{grams.toFixed(2)}<span className="text-xs ml-0.5 opacity-60">g</span></>
          ) : (
            <>{ml.toFixed(2)}<span className="text-xs ml-0.5 opacity-60">ml</span></>
          )}
        </span>
        <span className="text-[10px] text-neutral-500 font-medium mt-1">
          {isWeight ? `${ml.toFixed(2)}ml` : `${grams.toFixed(2)}g`} • {drops} drops
        </span>
      </div>
    </div>
  );
}

function IngredientCostCalculator({ 
  label, 
  value, 
  onUpdate 
}: { 
  label: string, 
  value: number, 
  onUpdate: (val: number) => void 
}) {
  const [pkgSize, setPkgSize] = useState<string>('');
  const [pkgPrice, setPkgPrice] = useState<string>('');
  const [shipCost, setShipCost] = useState<string>('');
  const [totalVol, setTotalVol] = useState<string>('');
  const [showCalc, setShowCalc] = useState(false);

  useEffect(() => {
    const size = parseFloat(pkgSize);
    const price = parseFloat(pkgPrice);
    const ship = parseFloat(shipCost) || 0;
    const vol = parseFloat(totalVol) || size;

    if (size > 0 && price > 0) {
      const shippingPerMl = ship > 0 && vol > 0 ? ship / vol : 0;
      const costPerMl = (price / size) + shippingPerMl;
      onUpdate(parseFloat(costPerMl.toFixed(4)));
    }
  }, [pkgSize, pkgPrice, shipCost, totalVol]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{label} ($/ml)</Label>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-6 px-1.5 text-[9px] uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-bold"
          onClick={() => setShowCalc(!showCalc)}
        >
          {showCalc ? 'Hide Calc' : 'Calculator'}
        </Button>
      </div>
      <Input 
        type="number" 
        step="0.001"
        className="h-9 text-sm font-mono"
        value={value || ''} 
        onChange={(e) => onUpdate(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      
      {showCalc && (
        <div className="mt-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 space-y-3 animate-in fade-in slide-in-from-top-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[9px] uppercase font-bold text-neutral-400 tracking-tight">Pkg Size (ml)</Label>
              <Input 
                type="number" 
                className="h-8 text-xs" 
                placeholder="100"
                value={pkgSize} 
                onChange={(e) => setPkgSize(e.target.value)} 
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[9px] uppercase font-bold text-neutral-400 tracking-tight">Pkg Price ($)</Label>
              <Input 
                type="number" 
                className="h-8 text-xs" 
                placeholder="15.00"
                value={pkgPrice} 
                onChange={(e) => setPkgPrice(e.target.value)} 
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[9px] uppercase font-bold text-neutral-400 tracking-tight">Ship Cost ($)</Label>
              <Input 
                type="number" 
                className="h-8 text-xs" 
                placeholder="5.00"
                value={shipCost} 
                onChange={(e) => setShipCost(e.target.value)} 
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[9px] uppercase font-bold text-neutral-400 tracking-tight">Total Vol (ml)</Label>
              <Input 
                type="number" 
                className="h-8 text-xs" 
                placeholder="500"
                value={totalVol} 
                onChange={(e) => setTotalVol(e.target.value)} 
              />
            </div>
          </div>
          <p className="text-[9px] text-neutral-400 dark:text-neutral-500 italic text-center">Calculates cost per ml including shipping</p>
        </div>
      )}
    </div>
  );
}

interface OrderSummaryProps {
  order: Order;
  onMarkReceived: (id: string) => void;
  onDelete: (order: Order) => void;
  key?: string;
}

function OrderSummary({ order, onMarkReceived, onDelete }: OrderSummaryProps) {
  const [showItems, setShowItems] = useState(false);
  
  return (
    <div className="bg-white dark:bg-neutral-900 border border-purple-100 dark:border-purple-800 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div 
        className="p-3 cursor-pointer flex items-center justify-between"
        onClick={() => setShowItems(!showItems)}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-tighter truncate max-w-[100px]">
              {order.vendor}
            </span>
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono border-purple-100 dark:border-purple-900 bg-purple-50/30 dark:bg-purple-900/10">
              {order.orderNumber}
            </Badge>
          </div>
          <p className="text-[10px] text-neutral-400">
            {new Date(order.createdAt).toLocaleDateString()} • {order.items.length} {order.items.length === 1 ? flavor() : flavors()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
              {order.currency} {order.totalCost.toFixed(2)}
            </p>
            <Badge 
              variant={order.status === 'received' ? 'secondary' : 'default'} 
              className={`text-[8px] h-3.5 px-1 uppercase tracking-widest leading-none ${
                order.status === 'received' 
                  ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 border-none' 
                  : 'bg-purple-600 text-white border-none'
              }`}
            >
              {order.status}
            </Badge>
          </div>
          {showItems ? <ChevronUp className="w-3.5 h-3.5 text-neutral-400" /> : <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />}
        </div>
      </div>
      
      <AnimatePresence>
        {showItems && (
          <motion.div 
            key="order-items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-purple-50 dark:border-purple-900/50"
          >
            <div className="p-3 bg-purple-50/20 dark:bg-purple-950/10 space-y-3">
              <div className="space-y-1.5">
                {order.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-[11px] leading-tight">
                    <span className="text-neutral-600 dark:text-neutral-400 truncate pr-2">{item.name}</span>
                    <span className="font-mono text-neutral-400 shrink-0">{item.volumeMl.toFixed(2)}ml</span>
                  </div>
                ))}
              </div>
              
              {order.status === 'pending' && (
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white h-7 text-[10px] font-bold gap-1.5 shadow-sm"
                    onClick={() => onMarkReceived(order.id)}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Order Received
                  </Button>
                  <Button 
                    variant="ghost"
                    size="sm" 
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={() => onDelete(order)}
                    title="Delete Order"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
              {order.status === 'received' && (
                <div className="flex items-center justify-between">
                  {order.receivedAt && (
                    <div className="flex items-center gap-1.5 py-1 text-[10px] text-green-600 dark:text-green-500 font-bold uppercase tracking-wider">
                      <Check className="w-3 h-3" />
                      Received {new Date(order.receivedAt).toLocaleDateString()}
                    </div>
                  )}
                  <Button 
                    variant="ghost"
                    size="sm" 
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto"
                    onClick={() => onDelete(order)}
                    title="Delete Order History"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InventoryManager({ 
  inventory, 
  recipes, 
  shoppingList,
  orders = [],
  onAddInventoryItem,
  onRemoveInventoryItem,
  onUpdateInventoryItem,
  onAddShoppingItem,
  onRemoveShoppingItem,
  onClearShoppingList,
  onMarkOrderReceived,
  onDeleteOrder,
  userSettings,
  onImportInvoice,
  onImportStash,
  onFilterRecipes,
  onStartEditingFlavor,
  sharedEditingItem,
  setSharedEditingItem
}: { 
  inventory: InventoryFlavor[], 
  recipes: Recipe[], 
  shoppingList: ShoppingItem[],
  orders?: Order[],
  onAddInventoryItem: (item: InventoryFlavor) => void,
  onRemoveInventoryItem: (name: string) => void,
  onUpdateInventoryItem: (oldName: string, item: InventoryFlavor) => void,
  onAddShoppingItem: (item: ShoppingItem) => void,
  onRemoveShoppingItem: (id: string) => void,
  onClearShoppingList: () => void,
  onMarkOrderReceived: (orderId: string) => void,
  onDeleteOrder: (order: Order) => void,
  userSettings: UserSettings,
  onImportInvoice: () => void,
  onImportStash: () => void,
  onFilterRecipes: (filter: string) => void,
  onStartEditingFlavor: (item: InventoryFlavor, target?: 'stash' | 'shopping', focusField?: string) => void,
  sharedEditingItem: InventoryFlavor | null,
  setSharedEditingItem: (item: InventoryFlavor | null) => void
}) {
  const [newItem, setNewItem] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'manufacturer'>('name');
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  
  const [itemToDelete, setItemToDelete] = useState<InventoryFlavor | null>(null);
  const [itemToShop, setItemToShop] = useState<InventoryFlavor | null>(null);
  const [itemToAdd, setItemToAdd] = useState<string | null>(null);
  const [missingToShop, setMissingToShop] = useState<string | null>(null);
  const [shopToStash, setShopToStash] = useState<ShoppingItem | null>(null);
  const [volumeToAdd, setVolumeToAdd] = useState<string>('30');
  const [shoppingItemToRemove, setShoppingItemToRemove] = useState<ShoppingItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const exportShoppingList = () => {
    if (shoppingList.length === 0) return;
    const text = shoppingList
      .map(item => `- ${item.name} (Added: ${new Date(item.addedAt).toLocaleDateString()})`)
      .join('\n');
    const blob = new Blob([`Shopping List - ${new Date().toLocaleDateString()}\n\n${text}`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vape-shopping-list-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const missingFlavors = useMemo(() => {
    const rawFlavors = recipes.flatMap(r => r.flavors.map(f => f.name));
    const uniqueNames: string[] = [];
    
    rawFlavors.forEach(name => {
      if (!name) return;
      if (!uniqueNames.some(u => isFlavorMatch(u, name))) {
        uniqueNames.push(name);
      }
    });

    return uniqueNames.filter(f => !inventory.some(inv => isFlavorMatch(inv.name, f)));
  }, [recipes, inventory]);

  const sortFlavors = (list: InventoryFlavor[]) => {
    return [...list].sort((a, b) => {
      if (sortBy === 'manufacturer') {
        const ma = getManufacturer(a.name);
        const mb = getManufacturer(b.name);
        if (ma !== mb) return ma.localeCompare(mb);
      }
      return a.name.localeCompare(b.name);
    });
  };

  const sortedInventory = useMemo(() => {
    // Merge duplicates for display to improve the "Duplicate Detection" experience
    const merged: InventoryFlavor[] = [];
    inventory.forEach(item => {
      const existing = merged.find(m => isFlavorMatch(m.name, item.name));
      if (existing) {
        // Merge volumes
        existing.volumeMl = (existing.volumeMl || 0) + (item.volumeMl || 0);
        // Keep the more complete name if possible (the one with manufacturer in parens)
        if (item.name.includes('(') && !existing.name.includes('(')) {
          existing.name = item.name;
        }
        // If the newer one has safety warnings, append them
        if (item.safetyWarnings && item.safetyWarnings.length > 0) {
          existing.safetyWarnings = Array.from(new Set([...(existing.safetyWarnings || []), ...item.safetyWarnings]));
        }
      } else {
        merged.push({ ...item });
      }
    });
    return sortFlavors(merged);
  }, [inventory, sortBy]);
  const sortedShoppingList = useMemo(() => sortFlavors(shoppingList), [shoppingList, sortBy]);
  const sortedMissing = useMemo(() => {
    const missingItems = missingFlavors.map(name => ({ name }));
    return sortFlavors(missingItems);
  }, [missingFlavors, sortBy]);

  const flavorUsage = useMemo(() => {
    const usageMap: Record<string, number> = {};
    recipes.forEach(recipe => {
      recipe.flavors.forEach(f => {
        const name = f.name;
        // Find existing match to ensure consistent counting across slightly different names
        const matchKey = Object.keys(usageMap).find(k => isFlavorMatch(k, name));
        if (matchKey) {
          usageMap[matchKey]++;
        } else {
          usageMap[name] = 1;
        }
      });
    });
    return usageMap;
  }, [recipes]);

  const getUsageCount = (name: string) => {
    const matchKey = Object.keys(flavorUsage).find(k => isFlavorMatch(k, name));
    return matchKey ? flavorUsage[matchKey] : 0;
  };

  const addItem = (item?: string) => {
    const flavorNameToAdd = item || newItem;
    if (flavorNameToAdd) {
      const existing = inventory.find(i => isFlavorMatch(i.name, flavorNameToAdd));
      if (existing) {
        // Flavor already exists, open it for editing instead of showing the "Add" dialog
        onStartEditingFlavor(existing, 'stash', 'volumeMl');
        setNewItem(''); // Clear input
      } else {
        setItemToAdd(flavorNameToAdd);
      }
    }
  };

  const removeItem = (item: InventoryFlavor) => {
    onRemoveInventoryItem(item.name);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4">
        <div>
          <CardTitle className="text-xl">{flavor(true)} Stash</CardTitle>
          <CardDescription>Manage your {flavor()} inventory and track missing ingredients.</CardDescription>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button 
            variant="outline" 
            size="sm" 
            className="h-9 gap-2 bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
            onClick={onImportInvoice}
          >
            <Upload className="w-3.5 h-3.5" />
            Invoice
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-9 gap-2 bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
            onClick={onImportStash}
          >
            <FileDown className="w-3.5 h-3.5" />
            ATF/ELR
          </Button>
          <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block dark:bg-neutral-700" />
          <Label htmlFor="sort" className="text-xs font-medium text-neutral-500 dark:text-neutral-400 whitespace-nowrap">Sort by:</Label>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger id="sort" className="w-full sm:w-[160px] h-9 bg-white dark:bg-neutral-800">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" />
                <SelectValue placeholder="Sort by">
                  {INVENTORY_SORT_OPTIONS[sortBy]}
                </SelectValue>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Alphabetical</SelectItem>
              <SelectItem value="manufacturer">Manufacturer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <PlusCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input 
              placeholder="Add flavor (e.g. Strawberry Ripe (TFA))" 
              className="pl-9"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
            />
          </div>
          <Button onClick={() => addItem()} className="bg-neutral-900 dark:bg-neutral-200 hover:bg-neutral-800 dark:hover:bg-neutral-300 text-white dark:text-neutral-900 font-bold">
            Add
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                In Stock
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-none">
                  {inventory.length}
                </Badge>
              </h3>
            </div>
            <ScrollArea className="h-[600px] rounded-xl border border-green-100 dark:border-green-900 bg-green-50/20 dark:bg-green-950/20 p-4">
                <div className="flex flex-col gap-2">
                  {sortedInventory.map((item, idx) => {
                    const isOnShoppingList = shoppingList.some(s => isFlavorMatch(s.name, item.name));
                    const itemKey = item.id || `${item.name}-${idx}`;
                    return (
                      <div key={itemKey} className="flex flex-col gap-1 w-full">
                        <div 
                          className="pl-3 pr-2 py-2 gap-4 group bg-white dark:bg-neutral-900 border border-green-100 dark:border-green-800 rounded-xl shadow-sm hover:border-green-300 dark:hover:border-green-700 transition-colors h-auto w-full whitespace-normal items-center cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-green-50 dark:hover:ring-green-900 flex justify-between"
                          onClick={() => onStartEditingFlavor(item)}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 font-mono shrink-0">
                              {getManufacturer(item.name)}
                            </span>
                            <div className="flex flex-col flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200 leading-tight truncate">
                                  {formatFlavorName(item.name)}
                                </span>
                                {(item.safetyWarnings || getSafetyWarnings(item.name)).length > 0 && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger>
                                        <div className="shrink-0 p-0.5 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 animate-pulse cursor-help" />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-[250px] bg-red-950 text-red-100 border-red-900">
                                        <p className="text-xs font-bold mb-1">Safety Concern:</p>
                                        <p className="text-[10px] leading-relaxed">{(item.safetyWarnings || getSafetyWarnings(item.name)).join(" ")}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                {item.notes && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedNotes(prev => ({ ...prev, [item.name]: !prev[item.name] }));
                                    }}
                                    className={`hover:text-blue-500 transition-colors shrink-0 ${expandedNotes[item.name] ? 'text-blue-500' : 'text-neutral-400'}`}
                                    title="View Notes"
                                  >
                                    <StickyNote className="w-3 h-3" />
                                  </button>
                                )}
                                {item.volumeMl !== undefined && (
                                  <Badge 
                                    variant="secondary" 
                                    className={`text-[9px] h-4 px-1.5 font-bold ${
                                      item.volumeMl <= (userSettings.lowStockThreshold || 0)
                                        ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-100 dark:border-red-900/50'
                                        : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-none'
                                    }`}
                                  >
                                    {item.volumeMl.toFixed(2)}ml
                                    {item.volumeMl <= (userSettings.lowStockThreshold || 0) && (
                                      <AlertTriangle className="w-2.5 h-2.5 ml-1" />
                                    )}
                                  </Badge>
                                )}
                                {getUsageCount(item.name) > 0 && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onFilterRecipes(item.name);
                                    }}
                                    className="text-[10px] font-bold text-blue-500 hover:text-blue-600 hover:underline flex items-center gap-0.5 shrink-0"
                                    title={`Used in ${getUsageCount(item.name)} ${getUsageCount(item.name) === 1 ? 'recipe' : 'recipes'}`}
                                  >
                                    <Book className="w-2.5 h-2.5" /> {getUsageCount(item.name)}
                                  </button>
                                )}
                              </div>
                              {item.costPerMl && (
                                <span className="text-[9px] text-neutral-400 dark:text-neutral-500 font-mono mt-0.5">
                                  ${item.costPerMl.toFixed(2)}/ml
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                            {!isOnShoppingList && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 rounded-full hover:bg-blue-50 text-blue-600 transition-colors"
                                onClick={() => setItemToShop(item)}
                                title="Add to Shopping List (Running Low)"
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6 rounded-full hover:bg-red-50 hover:text-red-600 text-neutral-400 transition-colors shrink-0"
                              onClick={() => setItemToDelete(item)}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                        <AnimatePresence>
                          {item.notes && expandedNotes[item.name] && (
                            <motion.div
                              key={`${item.name}-notes`}
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 py-2 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100/50 dark:border-blue-900/30 rounded-lg mx-1 mb-1">
                                <p className="text-[11px] text-neutral-600 dark:text-neutral-400 italic whitespace-normal leading-relaxed">
                                  {item.notes}
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                  {inventory.length === 0 && (
                    <div className="flex flex-col items-center justify-center w-full py-12 text-neutral-400">
                      <Droplets className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-sm italic">Your stash is empty</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2 min-h-[44px]">
                <div className="flex items-center justify-between gap-2 overflow-hidden">
                  <h3 className="text-[13px] font-bold flex items-center gap-2 text-blue-700 min-w-0">
                    <ShoppingCart className="w-4 h-4 shrink-0" />
                    <span className="truncate">Shopping</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-blue-100 text-blue-700 border-none shrink-0">
                      {shoppingList.length}
                    </Badge>
                  </h3>
                  {shoppingList.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 px-2 text-[10px] text-blue-600 hover:text-blue-700 gap-1 shrink-0"
                      onClick={exportShoppingList}
                    >
                      <Download className="w-3 h-3" />
                      <span className="hidden sm:inline">Export</span>
                    </Button>
                  )}
                </div>
                {shoppingList.length > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 w-full text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 border border-neutral-100 dark:border-neutral-800 flex items-center justify-center gap-1.5"
                    onClick={() => setShowClearConfirm(true)}
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear Shopping List
                  </Button>
                )}
              </div>
              <ScrollArea className="h-[600px] rounded-xl border border-blue-100 dark:border-blue-900 bg-blue-50/20 dark:bg-blue-950/20 p-3">
                <div className="space-y-2">
                  {sortedShoppingList.map((item) => (
                    <div 
                      key={item.id} 
                      className="flex items-center justify-between bg-white dark:bg-neutral-900 p-3 rounded-xl border border-blue-100 dark:border-blue-800 shadow-sm group cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors gap-4"
                      onClick={() => {
                        const existing = inventory.find(inv => inv.name === item.name);
                        const flavorObj = existing || { name: item.name };
                        onStartEditingFlavor(flavorObj);
                      }}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-500 dark:text-blue-400 font-mono shrink-0">
                          {getManufacturer(item.name)}
                        </span>
                        <div className="flex flex-col flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200 leading-tight truncate">
                              {formatFlavorName(item.name)}
                            </p>
                            {getUsageCount(item.name) > 0 && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFilterRecipes(item.name);
                                }}
                                className="text-[10px] font-bold text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:underline flex items-center gap-0.5 shrink-0"
                                title={`Used in ${getUsageCount(item.name)} ${getUsageCount(item.name) === 1 ? 'recipe' : 'recipes'}`}
                              >
                                <Book className="w-2.5 h-2.5" /> {getUsageCount(item.name)}
                              </button>
                            )}
                          </div>
                          <p className="text-[9px] text-neutral-400 dark:text-neutral-500 mt-0.5">Added {new Date(item.addedAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex gap-1 pr-1" onClick={(e) => e.stopPropagation()}>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20"
                          onClick={() => setShopToStash(item)}
                          title="Add to Stash"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-neutral-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400"
                          onClick={() => setShoppingItemToRemove(item)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {shoppingList.length === 0 && (
                    <p className="text-center py-8 text-xs text-neutral-400 italic">List is empty</p>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between min-h-[32px]">
                <h3 className="text-sm font-bold flex items-center gap-2 text-amber-700 dark:text-amber-500">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  Out of Stock
                </h3>
              </div>
              <ScrollArea className="h-[600px] rounded-xl border border-amber-100 dark:border-amber-900 bg-amber-50/20 dark:bg-amber-950/20 p-3">
                    <div className="space-y-2">
                  {sortedMissing.map((item, idx) => {
                    const isOnShoppingList = shoppingList.some(s => isFlavorMatch(s.name, item.name));
                    const itemKey = `missing-${item.name}-${idx}`;
                    return (
                      <div key={itemKey} className="flex items-center justify-between bg-white dark:bg-neutral-900 p-3 rounded-xl border border-amber-100 dark:border-amber-800 shadow-sm group gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-mono shrink-0">
                          {getManufacturer(item.name)}
                        </span>
                        <div className="flex flex-col flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200 leading-tight truncate">
                              {formatFlavorName(item.name)}
                            </p>
                            {getUsageCount(item.name) > 0 && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFilterRecipes(item.name);
                                }}
                                className="text-[10px] font-bold text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:underline flex items-center gap-0.5 shrink-0"
                                title={`Used in ${getUsageCount(item.name)} ${getUsageCount(item.name) === 1 ? 'recipe' : 'recipes'}`}
                              >
                                <Book className="w-2.5 h-2.5" /> {getUsageCount(item.name)}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 pr-1">
                        {!isOnShoppingList && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            onClick={() => setMissingToShop(item.name)}
                            title="Add to Shopping List"
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          onClick={() => addItem(item.name)}
                          title="Add to Stash"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {sortedMissing.length === 0 && (
                  <p className="text-center py-8 text-xs text-neutral-400 italic">No out of stock ingredients</p>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2 text-purple-700 dark:text-purple-400">
                <Package className="w-4 h-4" />
                Orders
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] bg-purple-100 text-purple-700 border-none">
                  {orders.filter(o => o.status === 'pending').length}
                </Badge>
              </h3>
            </div>
            <ScrollArea className="h-[600px] rounded-xl border border-purple-100 dark:border-purple-900 bg-purple-50/20 dark:bg-purple-950/20 p-3">
              <div className="space-y-3">
                {orders.length > 0 ? (
                  <>
                    {orders.filter(o => o.status === 'pending').length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest pl-1">Pending Orders</p>
                        {orders.filter(o => o.status === 'pending').sort((a, b) => b.createdAt - a.createdAt).map(order => (
                          <OrderSummary key={order.id} order={order} onMarkReceived={onMarkOrderReceived} onDelete={onDeleteOrder} />
                        ))}
                      </div>
                    )}
                    
                    {orders.filter(o => o.status === 'received').length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 pt-2 pb-1 text-neutral-400">
                          <History className="w-3 h-3" />
                          <p className="text-[10px] font-bold uppercase tracking-widest">Order History</p>
                        </div>
                        {orders.filter(o => o.status === 'received').sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map(order => (
                          <OrderSummary key={order.id} order={order} onMarkReceived={onMarkOrderReceived} onDelete={onDeleteOrder} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-neutral-400/50">
                    <Package className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-xs italic">No orders tracked</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <Dialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Remove {flavor(true)}</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove "{itemToDelete?.name}" from your stash?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setItemToDelete(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => {
                if (itemToDelete) {
                  onRemoveInventoryItem(itemToDelete.name);
                  setItemToDelete(null);
                }
              }}>Remove {flavor(true)}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!itemToShop} onOpenChange={(open) => !open && setItemToShop(null)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add to Shopping List</DialogTitle>
              <DialogDescription>
                Add "{itemToShop?.name}" to your shopping list?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setItemToShop(null)}>Cancel</Button>
              <Button onClick={() => {
                if (itemToShop) {
                  onAddShoppingItem({
                    id: Math.random().toString(36).substr(2, 9),
                    name: itemToShop.name,
                    addedAt: Date.now()
                  });
                }
                setItemToShop(null);
              }}>Add to List</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!itemToAdd} onOpenChange={(open) => !open && setItemToAdd(null)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add to Stash</DialogTitle>
              <DialogDescription>
                Add "{itemToAdd}" to your flavor stash?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setItemToAdd(null)}>Cancel</Button>
              <Button onClick={() => {
                if (itemToAdd) {
                  const newFlavor = { name: itemToAdd };
                  onAddInventoryItem(newFlavor);
                  if (itemToAdd === newItem) setNewItem('');
                  // Open the edit dialog immediately to allow adding volume, price, etc.
                  onStartEditingFlavor(newFlavor);
                }
                setItemToAdd(null);
              }}>Add to Stash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!missingToShop} onOpenChange={(open) => !open && setMissingToShop(null)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add to Shopping List</DialogTitle>
              <DialogDescription>
                Add "{missingToShop}" to your shopping list?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMissingToShop(null)}>Cancel</Button>
              <Button onClick={() => {
                if (missingToShop) {
                  onAddShoppingItem({
                    id: Math.random().toString(36).substr(2, 9),
                    name: missingToShop,
                    addedAt: Date.now()
                  });
                }
                setMissingToShop(null);
              }}>Add to List</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!shopToStash} onOpenChange={(open) => !open && setShopToStash(null)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Move to Stash</DialogTitle>
              <DialogDescription>
                Move "{shopToStash?.name}" from your shopping list to your stash?
              </DialogDescription>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="add-vol">Volume Added (ml)</Label>
                  <Input 
                    id="add-vol" 
                    type="number"
                    value={volumeToAdd} 
                    onChange={(e) => setVolumeToAdd(e.target.value)} 
                    placeholder="30"
                  />
                </div>
              </div>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShopToStash(null)}>Cancel</Button>
              <Button onClick={() => {
                if (shopToStash) {
                  const existing = inventory.find(inv => inv.name === shopToStash.name);
                  const addedVol = parseFloat(volumeToAdd) || 0;
                  const flavorObj = existing 
                    ? { ...existing, volumeMl: (existing.volumeMl || 0) + addedVol }
                    : { name: shopToStash.name, volumeMl: addedVol, costPerMl: 0 };
                  
                  if (existing) {
                    onUpdateInventoryItem(existing.name, flavorObj);
                  } else {
                    onAddInventoryItem(flavorObj);
                  }
                  onRemoveShoppingItem(shopToStash.id);
                }
                setShopToStash(null);
              }}>Move to Stash</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!shoppingItemToRemove} onOpenChange={(open) => !open && setShoppingItemToRemove(null)}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Remove from List</DialogTitle>
              <DialogDescription>
                Remove "{shoppingItemToRemove?.name}" from your shopping list?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShoppingItemToRemove(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => {
                if (shoppingItemToRemove) onRemoveShoppingItem(shoppingItemToRemove.id);
                setShoppingItemToRemove(null);
              }}>Remove</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Clear Shopping List</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove all {shoppingList.length} items from your shopping list? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowClearConfirm(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => {
                onClearShoppingList();
                setShowClearConfirm(false);
              }}>Clear All</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function FlavorEditDialog({ 
  item, 
  initialFocusField,
  onSave, 
  onCancel 
}: { 
  item: InventoryFlavor | null, 
  initialFocusField?: string | null,
  onSave: (oldName: string, item: InventoryFlavor) => void, 
  onCancel: () => void 
}) {
  const [editName, setEditName] = useState('');
  const [editManufacturer, setEditManufacturer] = useState('');
  const [editCost, setEditCost] = useState<string>('');
  const [editVolume, setEditVolume] = useState<string>('');
  const [editNotes, setEditNotes] = useState('');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const costInputRef = useRef<HTMLInputElement>(null);

  // Cost Calculator State
  const [pkgSize, setPkgSize] = useState<string>('');
  const [pkgPrice, setPkgPrice] = useState<string>('');
  const [shipCost, setShipCost] = useState<string>('');
  const [totalVol, setTotalVol] = useState<string>('');

  useEffect(() => {
    if (item) {
      setEditName(formatFlavorName(item.name));
      setEditManufacturer(getManufacturer(item.name));
      setEditCost(item.costPerMl?.toString() || '');
      setEditVolume(item.volumeMl ? Number(item.volumeMl.toFixed(2)).toString() : '');
      setEditNotes(item.notes || '');
      
      // Reset calculator
      setPkgSize('');
      setPkgPrice('');
      setShipCost('');
      setTotalVol('');
      setShowDiscardConfirm(false);

      // Focus cost field if requested
      if (initialFocusField === 'cost') {
        setTimeout(() => costInputRef.current?.focus(), 150);
      }
    }
  }, [item, initialFocusField]);

  const hasChanges = () => {
    if (!item) return false;
    const currentName = editName.trim();
    const currentMan = editManufacturer.trim().toUpperCase();
    const currentCost = editCost.trim();
    const currentVolume = editVolume.trim();
    const currentNotes = editNotes.trim();

    const initialName = formatFlavorName(item.name).trim();
    const initialMan = getManufacturer(item.name).trim().toUpperCase();
    const initialCost = (item.costPerMl?.toString() || '').trim();
    const initialVolume = (item.volumeMl ? Number(item.volumeMl.toFixed(2)).toString() : '').trim();
    const initialNotes = (item.notes || '').trim();

    return (
      currentName !== initialName ||
      currentMan !== initialMan ||
      currentCost !== initialCost ||
      currentVolume !== initialVolume ||
      currentNotes !== initialNotes
    );
  };

  const handleCancelAttempt = () => {
    if (hasChanges()) {
      setShowDiscardConfirm(true);
    } else {
      onCancel();
    }
  };

  const calculateCost = () => {
    const size = parseFloat(pkgSize);
    const price = parseFloat(pkgPrice);
    if (!size || !price) return;

    let costPerMl = price / size;
    const ship = parseFloat(shipCost);
    const vol = parseFloat(totalVol);

    if (ship && vol) {
      const shipPerMl = ship / vol;
      costPerMl += shipPerMl;
    }

    setEditCost(costPerMl.toFixed(4));
  };

  const handleSave = () => {
    if (!item) return;
    const trimmedName = editName.trim();
    const trimmedMan = editManufacturer.trim().toUpperCase();
    const newFlavorName = trimmedMan ? `${trimmedName} (${trimmedMan})` : trimmedName;
    const costValue = parseFloat(editCost);
    const cost = !isNaN(costValue) ? costValue : undefined;
    const volumeValue = parseFloat(editVolume);
    const volume = !isNaN(volumeValue) ? Number(volumeValue.toFixed(2)) : undefined;
    
    onSave(item.name, { ...item, name: newFlavorName, costPerMl: cost, volumeMl: volume, notes: editNotes });
  };

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && handleCancelAttempt()}>
      <DialogContent className="sm:max-w-[500px] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {flavor(true)}</DialogTitle>
          <DialogDescription>
            Update the flavor details and calculate accurate costs.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name-shared">{flavor(true)} Name</Label>
              <Input 
                id="edit-name-shared" 
                value={editName} 
                onChange={(e) => setEditName(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="e.g. Strawberry Ripe"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-man-shared">Manufacturer</Label>
              <Input 
                id="edit-man-shared" 
                value={editManufacturer} 
                onChange={(e) => setEditManufacturer(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="e.g. TFA, CAP, FA"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-vol-shared">Current Volume (ml)</Label>
              <Input 
                id="edit-vol-shared" 
                type="number"
                value={editVolume} 
                onChange={(e) => setEditVolume(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="edit-notes-shared">Flavor Notes</Label>
            <textarea 
              id="edit-notes-shared"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full min-h-[80px] p-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
              placeholder="e.g. Best around 3-5%, adds a creamy body, fades after 2 weeks"
            />
          </div>

          {(item?.safetyWarnings || getSafetyWarnings(editManufacturer ? `${editName} (${editManufacturer})` : editName)).length > 0 && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 rounded-lg space-y-1">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Safety Warning</span>
              </div>
              <p className="text-[11px] text-red-700/80 dark:text-red-300 leading-relaxed italic">
                {(item?.safetyWarnings || getSafetyWarnings(editManufacturer ? `${editName} (${editManufacturer})` : editName)).join(" ")}
              </p>
              <p className="text-[9px] text-neutral-400 mt-1 leading-tight">
                This flavor has been flagged as potentially containing components (like DAAP) that some users prefer to avoid.
              </p>
            </div>
          )}

          <div className="space-y-4 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
                <DollarSign className="w-4 h-4 text-green-600" />
                Cost Calculator
              </h4>
              <div className="flex items-center gap-2">
                <Label htmlFor="edit-cost-shared" className="text-xs font-bold text-neutral-500 dark:text-neutral-400">Cost/ml:</Label>
                <Input 
                  ref={costInputRef}
                  id="edit-cost-shared" 
                  type="number"
                  step="0.001"
                  className="w-24 h-8 text-xs font-mono dark:bg-neutral-800"
                  value={editCost} 
                  onChange={(e) => setEditCost(e.target.value)}
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Package Size (ml)</Label>
                <Input 
                  type="number" 
                  placeholder="30" 
                  className="h-8 text-sm dark:bg-neutral-800"
                  value={pkgSize}
                  onChange={(e) => setPkgSize(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Package Price ($)</Label>
                <Input 
                  type="number" 
                  placeholder="4.50" 
                  className="h-8 text-sm dark:bg-neutral-800"
                  value={pkgPrice}
                  onChange={(e) => setPkgPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-3">
              <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Shipping Apportionment (Optional)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Total Order Shipping ($)</Label>
                  <Input 
                    type="number" 
                    placeholder="10.00" 
                    className="h-8 text-sm dark:bg-neutral-800"
                    value={shipCost}
                    onChange={(e) => setShipCost(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Total Order Volume (ml)</Label>
                  <Input 
                    type="number" 
                    placeholder="500" 
                    className="h-8 text-sm dark:bg-neutral-800"
                    value={totalVol}
                    onChange={(e) => setTotalVol(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Button 
              variant="outline" 
              size="sm" 
              className="w-full h-8 text-xs bg-white dark:bg-neutral-800"
              onClick={calculateCost}
              disabled={!pkgSize || !pkgPrice}
            >
              Calculate & Apply Cost
            </Button>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancelAttempt}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>

        <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have made changes to this {flavor()}. Are you sure you want to discard them?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:justify-end">
              <Button variant="outline" onClick={() => setShowDiscardConfirm(false)}>
                Keep Editing
              </Button>
              <Button variant="destructive" onClick={() => {
                setShowDiscardConfirm(false);
                onCancel();
              }}>
                Discard Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function AiLab({ 
  inventory, 
  suggestions, 
  onSuggest, 
  isLoading, 
  onUseRecipe,
  runtimeKey,
  onSelectKey,
  hasAiStudio,
  userSettings,
  onUpdateSettings,
  isOnline
}: { 
  inventory: string[], 
  suggestions: any[], 
  onSuggest: (preferences?: string) => void, 
  isLoading: boolean, 
  onUseRecipe: (r: any) => void,
  runtimeKey: string | null,
  onSelectKey: () => void,
  hasAiStudio: boolean,
  userSettings: UserSettings,
  onUpdateSettings: (s: UserSettings) => void,
  isOnline: boolean
}) {
  const [manualKey, setManualKey] = useState(userSettings.geminiApiKey || '');
  const [preferences, setPreferences] = useState('');

  const handleSaveManual = () => {
    if (manualKey.trim()) {
      onUpdateSettings({ ...userSettings, geminiApiKey: manualKey.trim() });
    }
  };

  if (!isOnline) {
    return (
      <Card className="border-amber-100 dark:border-amber-900 bg-amber-50/20 dark:bg-amber-950/20">
        <CardHeader className="text-center flex flex-col items-center">
          <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mb-2">
            <CloudOff className="w-6 h-6 text-amber-600 dark:text-amber-500" />
          </div>
          <CardTitle className="text-amber-900 dark:text-amber-100">AI Lab is Offline</CardTitle>
          <CardDescription className="text-amber-700 dark:text-amber-300 max-w-sm">
            You are currently offline. AI-powered recipe generation requires an active internet connection to communicate with Google Gemini.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-8 text-xs text-amber-600 dark:text-amber-400 font-medium">
          Mixes and stash remain available for local use.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!runtimeKey ? (
        <Card className="border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
              <Sparkles className="w-5 h-5 text-purple-500" />
              AI Setup Required
            </CardTitle>
            <CardDescription className="dark:text-neutral-400">
              To use the AI Flavor Lab, you need to connect your own Gemini API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                Gemini is Google's AI that powers the recipe generation. You can get a free API key from the Google AI Studio.
              </p>
              
              <div className="flex flex-col gap-3">
                <Button 
                  className="w-full bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 text-white font-bold"
                  onClick={onSelectKey}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Connect via AI Studio
                </Button>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-neutral-200 dark:border-neutral-800"></span></div>
                  <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-neutral-50 dark:bg-neutral-900 px-2 text-neutral-400 font-bold">Or Manual Setup</span></div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Paste Gemini API Key</Label>
                  <div className="flex gap-2">
                    <Input 
                      type="password"
                      placeholder="AIza..."
                      className="h-9 text-sm dark:bg-neutral-800"
                      value={manualKey}
                      onChange={(e) => setManualKey(e.target.value)}
                    />
                    <Button onClick={handleSaveManual} disabled={!manualKey.trim()}>Save</Button>
                  </div>
                  <p className="text-[10px] text-neutral-400">
                    Get your key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 underline">aistudio.google.com/app/apikey</a>
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-gradient-to-br from-neutral-900 to-neutral-800 text-white border-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-yellow-400" />
              AI {flavor(true)} Lab
            </CardTitle>
            <CardDescription className="text-neutral-400">
              Let Gemini suggest new recipes based on your current inventory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center py-6 text-center">
              <p className="text-sm text-neutral-300 mb-6 max-w-md">
                The AI will analyze your {inventory.length} {flavors()} and create unique combinations with optimal percentages.
              </p>
              
              <div className="w-full max-w-md mb-6 space-y-2 text-left">
                <Label htmlFor="preferences" className="text-xs text-neutral-400 uppercase tracking-widest font-bold">
                  {flavor(true)} Preferences (Optional)
                </Label>
                <Input 
                  id="preferences"
                  placeholder="e.g. Creamy dessert, fruity menthol, tobacco blend..."
                  className="bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-600 h-10"
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                />
                <p className="text-[10px] text-neutral-500 italic">
                  * AI will still only use flavors you have in stock.
                </p>
              </div>

              <Button 
                size="lg" 
                className="bg-yellow-400 text-black hover:bg-yellow-500 font-bold px-8"
                onClick={() => onSuggest(preferences)}
                disabled={isLoading || inventory.length < 2}
              >
                {isLoading ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Thinking...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Generate Recipes</>
                )}
              </Button>
              {inventory.length < 2 && (
                <p className="text-xs text-red-400 mt-4">Add at least 2 {flavors()} to your stash first.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-1">
        <AnimatePresence mode="popLayout">
          {suggestions.map((suggestion, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="border-neutral-200 dark:border-neutral-800">
                <CardHeader className="p-4">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{suggestion.name}</CardTitle>
                      <div className="flex gap-2 items-center flex-wrap">
                        <div className="flex-1 space-y-2">
                          <CardDescription className="text-neutral-600 dark:text-neutral-400">{suggestion.description}</CardDescription>
                          
                          {/* Potency Warnings directly after description */}
                          {suggestion.flavors.map((f: any) => getPotencyWarning(f.name, f.percentage)).filter(Boolean).length > 0 && (
                            <div className="space-y-1.5 mt-2">
                              {suggestion.flavors.map((f: any, idx: number) => {
                                const warning = getPotencyWarning(f.name, f.percentage);
                                if (!warning) return null;
                                return (
                                  <div key={idx} className="flex gap-2 items-start text-[10px] sm:text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-500/20 shadow-sm">
                                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                                    <span className="font-medium leading-tight">{warning}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {suggestion.steepingDays > 0 && (
                          <Badge variant="secondary" className="bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800 flex items-center gap-1 text-[10px] shrink-0 self-start">
                            <RefreshCw size={10} className="rotate-90" /> {suggestion.steepingDays}d steep
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onUseRecipe(suggestion)}>
                      Use Recipe
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex flex-wrap gap-2">
                    {suggestion.flavors.map((f: any, j: number) => (
                      <Badge key={j} variant="secondary" className="bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
                        {f.name}: {f.percentage}%
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SettingsPanel({ 
  costs, 
  onUpdate, 
  userSettings,
  onUpdateSettings,
  runtimeKey, 
  onSelectKey,
  user,
  onLogin,
  onLogout,
  onSync,
  isSyncing,
  syncError,
  onExport,
  onImport,
  onDeleteAllData,
  onOpenPrivacy,
  onOpenSafety
}: { 
  costs: IngredientCost, 
  onUpdate: (c: IngredientCost) => void, 
  userSettings: UserSettings,
  onUpdateSettings: (s: UserSettings) => void,
  runtimeKey: string | null, 
  onSelectKey: () => void,
  user: User | null,
  onLogin: () => void,
  onLogout: () => void,
  onSync: () => void,
  isSyncing: boolean,
  syncError: string | null,
  onExport: () => void,
  onImport: (file: File) => void,
  onDeleteAllData: () => Promise<void>,
  onOpenPrivacy: () => void,
  onOpenSafety: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className="space-y-6">
      <Card className="border-blue-100 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-900/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-blue-900 dark:text-blue-100">
                <Cloud className="w-5 h-5 text-blue-500" />
                Cloud Sync & Account
              </CardTitle>
              <CardDescription className="text-blue-700/70 dark:text-blue-300/70">
                Sync your recipes, stash, and settings across all your devices.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {user ? (
            <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-blue-100 dark:border-blue-900 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="flex items-center outline-none focus:ring-2 focus:ring-blue-500/20 rounded-full transition-shadow">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt="User" className="w-10 h-10 rounded-full border border-neutral-200 dark:border-neutral-800" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                          <UserIcon className="w-5 h-5" />
                        </div>
                      )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel className="font-normal">
                          <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium leading-none">{user.displayName || 'User'}</p>
                            <p className="text-xs leading-none text-muted-foreground">
                              {user.email}
                            </p>
                          </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/10" onClick={onLogout}>
                          <LogOut className="mr-2 h-4 w-4" />
                          <span>Sign Out</span>
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div>
                    <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{user.displayName || 'VapeMix User'}</p>
                    <p className="text-xs text-neutral-500">{user.email}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={onLogout}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </div>
              <Separator className="dark:bg-neutral-800" />
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300">One-time Sync</p>
                    <p className="text-[10px] text-neutral-500">Push your local data to the cloud for the first time.</p>
                  </div>
                  <Button size="sm" onClick={onSync} disabled={isSyncing} className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600">
                    {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin mr-2" /> : <Cloud className="w-3 h-3 mr-2" />}
                    Sync Local to Cloud
                  </Button>
                </div>
                {syncError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900 rounded-lg flex items-start gap-2 text-red-600 dark:text-red-400">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="text-xs font-bold">Sync Failed</p>
                      <p className="text-[10px] leading-relaxed">{syncError}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 bg-white dark:bg-neutral-900 rounded-xl border border-blue-100 dark:border-blue-900 shadow-sm flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                <CloudOff className="w-6 h-6 text-blue-400 dark:text-blue-500" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Not Signed In</p>
                <p className="text-xs text-neutral-500 max-w-[200px]">Sign in with Google to sync your mixology data across devices.</p>
              </div>
              <Button onClick={onLogin} className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 gap-2">
                <LogIn className="w-4 h-4" />
                Sign In with Google
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            AI Configuration
          </CardTitle>
          <CardDescription>Configure your Gemini API key for the AI Flavor Lab.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              Gemini API Key
              {userSettings.geminiApiKey && (
                <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 border-none h-4 text-[9px]">Connected</Badge>
              )}
            </Label>
            <Input 
              type="password" 
              placeholder="AIza..."
              value={userSettings.geminiApiKey || ''} 
              onChange={(e) => onUpdateSettings({ ...userSettings, geminiApiKey: e.target.value })}
            />
            <p className="text-[10px] text-neutral-400">
              Key is synced to your account. Get one at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 underline">aistudio.google.com</a>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Global Default Preferences</CardTitle>
          <CardDescription>These values will be used as defaults when creating or importing new recipes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Default Serving Size (ml)</Label>
              <Input 
                type="number" 
                value={userSettings.defaultServingMl || ''} 
                onChange={(e) => onUpdateSettings({ ...userSettings, defaultServingMl: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Default Target Nicotine (mg)</Label>
              <Input 
                type="number" 
                value={userSettings.defaultTargetNicMg === 0 ? '' : userSettings.defaultTargetNicMg} 
                onChange={(e) => onUpdateSettings({ ...userSettings, defaultTargetNicMg: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Default PG Ratio (%)</Label>
              <Input 
                type="number" 
                value={userSettings.defaultTargetPgRatio || ''} 
                onChange={(e) => onUpdateSettings({ ...userSettings, defaultTargetPgRatio: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Default Nic Base Strength (mg)</Label>
              <Input 
                type="number" 
                value={userSettings.defaultNicBaseMg || ''} 
                onChange={(e) => onUpdateSettings({ ...userSettings, defaultNicBaseMg: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Default Nic Base Type</Label>
              <Select 
                value={userSettings.defaultNicBaseType} 
                onValueChange={(val: 'PG' | 'VG') => onUpdateSettings({ ...userSettings, defaultNicBaseType: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PG">PG</SelectItem>
                  <SelectItem value="VG">VG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mixing Preference</Label>
              <Select 
                value={userSettings.mixingPreference || 'weight'} 
                onValueChange={(value: 'weight' | 'volume') => onUpdateSettings({ ...userSettings, mixingPreference: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select preference">
                    {MIXING_PREFERENCE_OPTIONS[userSettings.mixingPreference || 'weight']}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weight">By Weight (Grams)</SelectItem>
                  <SelectItem value="volume">By Volume (Milliliters)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Low Stock Threshold (ml)</Label>
              <Input 
                type="number" 
                value={userSettings.lowStockThreshold || ''} 
                onChange={(e) => onUpdateSettings({ ...userSettings, lowStockThreshold: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>PG Density (g/ml)</Label>
              <Input 
                type="number" 
                step="0.001"
                value={userSettings.pgDensity || 1.038} 
                onChange={(e) => onUpdateSettings({ ...userSettings, pgDensity: e.target.value === '' ? 1.038 : Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>VG Density (g/ml)</Label>
              <Input 
                type="number" 
                step="0.001"
                value={userSettings.vgDensity || 1.26} 
                onChange={(e) => onUpdateSettings({ ...userSettings, vgDensity: e.target.value === '' ? 1.26 : Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>AI Flavor Lab Training (Custom Guidelines)</Label>
              <textarea 
                placeholder="Give the AI specific rules, e.g. 'Never use WS-23 above 0.5%', 'Prefer simple 3-ingredient recipes', 'Treat FLV flavors as ultra-concentrates'."
                value={userSettings.aiCustomInstructions || ''} 
                onChange={(e) => onUpdateSettings({ ...userSettings, aiCustomInstructions: e.target.value })}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 h-24"
              />
              <p className="text-xs text-muted-foreground">
                These rules will be sent to the AI when generating recipe suggestions to help "train" its output to your preferences.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Display Theme</Label>
              <Select 
                value={userSettings.theme || 'light'} 
                onValueChange={(value: 'light' | 'dark' | 'system') => onUpdateSettings({ ...userSettings, theme: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select theme">
                    {THEME_OPTIONS[userSettings.theme || 'light']}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light Mode</SelectItem>
                  <SelectItem value="dark">Dark Mode</SelectItem>
                  <SelectItem value="system">System (Auto)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ingredient Costs</CardTitle>
          <CardDescription>Set your local prices to calculate the cost per mix.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <IngredientCostCalculator 
              label="Nicotine" 
              value={costs.nicCostPerMl} 
              onUpdate={(val) => onUpdate({ ...costs, nicCostPerMl: val })} 
            />
            <IngredientCostCalculator 
              label="PG" 
              value={costs.pgCostPerMl} 
              onUpdate={(val) => onUpdate({ ...costs, pgCostPerMl: val })} 
            />
            <IngredientCostCalculator 
              label="VG" 
              value={costs.vgCostPerMl} 
              onUpdate={(val) => onUpdate({ ...costs, vgCostPerMl: val })} 
            />
            <div className="space-y-2">
              <Label className="text-xs font-medium text-neutral-700">Bottle Cost ($)</Label>
              <Input 
                type="number" 
                className="h-9 text-sm font-mono"
                value={costs.bottleCost || ''} 
                onChange={(e) => onUpdate({ ...costs, bottleCost: e.target.value === '' ? 0 : Number(e.target.value) })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-neutral-500" />
            Maintenance
          </CardTitle>
          <CardDescription>Backup and restore your data. Importing will overwrite your current data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              variant="outline" 
              className="flex-1 gap-2"
              onClick={onExport}
            >
              <Download className="w-4 h-4" />
              Download Data Backup
            </Button>
            <div className="flex-1">
              <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImport(file);
                }}
              />
              <Button 
                variant="outline" 
                className="w-full gap-2 border-neutral-200 hover:bg-neutral-50 text-neutral-700"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" />
                Import Data Backup
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-4 h-4" />
              <p className="text-xs font-bold uppercase tracking-wider">Danger Zone</p>
            </div>
            <p className="text-xs text-neutral-500">
              Delete all recipes, flavors, settings, and costs. This action is irreversible.
            </p>
            <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
              <DialogTrigger 
                render={
                  <Button variant="destructive" className="w-full sm:w-auto gap-2">
                    <Trash2 className="w-4 h-4" />
                    Delete All User Data
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-red-600">
                    <AlertTriangle className="w-5 h-5" />
                    Are you absolutely sure?
                  </DialogTitle>
                  <DialogDescription className="space-y-3 pt-2 block">
                    <div className="space-y-3">
                    <p className="font-bold text-neutral-900">
                      This will permanently delete all your data from this device and the cloud.
                    </p>
                    <ul className="list-disc list-inside text-sm space-y-1">
                      <li>All Recipes</li>
                      <li>All {flavors(true)} in Stash</li>
                      <li>Gemini API Key</li>
                      <li>Global Preferences</li>
                      <li>Ingredient Costs</li>
                    </ul>
                    <p className="text-red-600 font-medium">
                      This action cannot be undone.
                    </p>
                    </div>
                  </DialogDescription>
                </DialogHeader>
                <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-2">
                  <p className="text-xs font-bold text-neutral-700 uppercase tracking-wider">Recommended Action</p>
                  <p className="text-xs text-neutral-500">
                    Download a backup of your data before proceeding, just in case you change your mind later.
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full gap-2 mt-2"
                    onClick={() => {
                      onExport();
                    }}
                  >
                    <Download className="w-3 h-3" />
                    Download Backup First
                  </Button>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                  <Button 
                    variant="destructive" 
                    onClick={async () => {
                      await onDeleteAllData();
                      setShowDeleteConfirm(false);
                    }}
                  >
                    Yes, Delete Everything
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            Legal & Safety
          </CardTitle>
          <CardDescription>Important information regarding your privacy and safety while using this application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button 
            variant="outline" 
            className="w-full justify-start gap-3 h-12 text-sm border-neutral-200 dark:border-neutral-800 hover:bg-purple-50 dark:hover:bg-purple-900/10 text-neutral-700 dark:text-neutral-300 transition-colors"
            onClick={onOpenPrivacy}
          >
            <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="text-left">
              <p className="font-bold leading-tight">Privacy & Data Policy</p>
              <p className="text-[10px] text-neutral-500 font-normal">How we handle your personal data and account info.</p>
            </div>
            <ChevronRight className="w-4 h-4 ml-auto text-neutral-300" />
          </Button>

          <Button 
            variant="outline" 
            className="w-full justify-start gap-3 h-12 text-sm border-neutral-200 dark:border-neutral-800 hover:bg-red-50 dark:hover:bg-red-900/10 text-neutral-700 dark:text-neutral-300 transition-colors"
            onClick={onOpenSafety}
          >
            <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="text-left">
              <p className="font-bold leading-tight">Safety Warning & Disclaimer</p>
              <p className="text-[10px] text-neutral-500 font-normal">Known health risks and DIY mixing precautions.</p>
            </div>
            <ChevronRight className="w-4 h-4 ml-auto text-neutral-300" />
          </Button>
        </CardContent>
      </Card>

      <Card className="border-neutral-200 dark:border-neutral-800 bg-neutral-50/10">
        <CardContent className="py-4">
          <div className="flex flex-col items-center text-center space-y-2">
            <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-neutral-400" />
              Support & Feedback
            </p>
            <p className="text-[10px] text-neutral-500 max-w-[250px]">
              Found a bug or have a feature request? We'd love to hear from you.
            </p>
            <Button 
              variant="outline" 
              size="sm"
              className="mt-1 gap-2 h-8 text-xs border-neutral-200 dark:border-neutral-800"
              onClick={() => window.location.href = 'mailto:vapemix.ai@gmail.com'}
            >
              Contact Developer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SafetyDisclaimerDialog({ 
  open, 
  onOpenChange, 
  onAcknowledge,
  showAcknowledgeButton = false 
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  onAcknowledge?: () => void,
  showAcknowledgeButton?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            Safety Warning & Disclaimer
          </DialogTitle>
          <DialogDescription>
            Please read this information carefully before using VapeMix AI.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-2 space-y-4 py-4 text-sm text-neutral-600 dark:text-neutral-400">
          <section className="space-y-2">
            <h3 className="font-bold text-neutral-900 dark:text-neutral-100">1. Health Risks</h3>
            <p>
              Vaping and the use of e-liquids carry significant health risks, both known and unknown. Nicotine is a highly addictive substance. Long-term effects of inhaling vaporized flavorings, PG, and VG are still being studied and may be harmful to your respiratory and cardiovascular systems.
            </p>
          </section>
          
          <section className="space-y-2">
            <h3 className="font-bold text-neutral-900 dark:text-neutral-100">2. DIY Mixing Dangers</h3>
            <p>
              Mixing your own e-liquid involves handling concentrated nicotine, which can be toxic if absorbed through the skin or swallowed. Inaccurate measurements can lead to dangerously high nicotine levels. Always handle nicotine with extreme care, using gloves and eye protection.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-neutral-900 dark:text-neutral-100">3. Ingredient Safety</h3>
            <p>
              Some flavorings contain components such as Diacetyl, Acetyl Propionyl, or Acetoin (DAAP), which have been linked to lung disease in some studies. Other components like sucralose may produce harmful compounds when heated. VapeMix AI provides basic warnings for some of these, but it is NOT an exhaustive list.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-neutral-900 dark:text-neutral-100">4. No Professional Advice</h3>
            <p>
              VapeMix AI is a tool for calculations and data management only. It does not provide medical or professional advice. The recipes generated or stored here are not verified for safety. You should conduct independent research into every ingredient you use in your mixes.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-bold text-neutral-900 dark:text-neutral-100 italic">5. Use at Your Own Risk</h3>
            <p className="font-medium">
              By using this application, you acknowledge that you are doing so at your own risk. The developers of VapeMix AI are not responsible for any adverse health effects, injuries, or damages resulting from the use of this app or the creation/use of e-liquids based on its output.
            </p>
          </section>
        </div>
        <DialogFooter className="mt-4">
          {showAcknowledgeButton ? (
            <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={onAcknowledge}>
              I Understand & Accept These Risks
            </Button>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StashImportDialog({ 
  open, 
  onOpenChange, 
  onImport 
}: { 
  open: boolean, 
  onOpenChange: (open: boolean) => void, 
  onImport: (items: InventoryFlavor[]) => number 
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setSuccessCount(null);

    const sanitizeItems = (items: any[]): InventoryFlavor[] => {
      return items.map(item => {
        // Strip HTML tags and limit length to prevent XSS/Layout injection
        const rawName = String(item.name || '').replace(/<[^>]*>?/gm, '').trim();
        const rawNotes = String(item.notes || '').replace(/<[^>]*>?/gm, '').trim();
        
        // Final safety check: enforce reasonable length limits
        const name = rawName.substring(0, 200);
        const notes = rawNotes.substring(0, 1000);
        
        // Ensure volume is a valid positive number
        let volumeMl = parseFloat(item.volumeMl);
        if (isNaN(volumeMl) || !isFinite(volumeMl) || volumeMl < 0) {
          volumeMl = 0;
        }

        // Ensure cost is a valid positive number
        const parsedCost = parseFloat(item.costPerMl);
        const costPerMl = (!isNaN(parsedCost) && isFinite(parsedCost) && parsedCost > 0) 
          ? parsedCost 
          : undefined;

        return { name, volumeMl, notes, costPerMl };
      }).filter(f => f.name.length > 0); // Must have a name
    };

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        let rawFlavors: any[] = [];

        if (file.name.toLowerCase().endsWith('.json')) {
          // ATF JSON
          const data = JSON.parse(content);
          const flavors = Array.isArray(data) ? data : (data.flavors || []);
          rawFlavors = flavors.map((f: any) => {
            let name = f.name || f.flavor_name || '';
            const vendor = f.vendor || f.vendor_abbreviation || '';
            if (name && vendor) {
              name = `${name} (${vendor})`;
            } else if (!name) {
              name = f.name_with_vendor || '';
            }

            return {
              name: name,
              volumeMl: f.stockLevel !== undefined ? f.stockLevel : (f.volume || f.amount || f.volume_ml || 0),
              costPerMl: f.costPerML,
              notes: f.notes || ''
            };
          });
        } else if (file.name.toLowerCase().endsWith('.csv')) {
          // ELR or ATF CSV
          Papa.parse(content, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              const flavors = results.data.map((row: any) => {
                // ATF uses 'name' and 'vendor'. ELR uses 'Flavor' and 'Company'.
                const rawName = row.name || row.Flavor || row.flavor || '';
                const company = row.vendor || row.Company || row.company || row.vendor_abbreviation || row.Manufacturer || '';
                
                // ATF uses 'stockLevel' for current stash. ELR uses 'Amount'.
                // If stockLevel is missing (ATF export might vary), fall back to 'volume' or 'Amount'.
                const volume = row.stockLevel || row.volume || row.Amount || row.amount || row.Volume || '0';
                
                // Notes mapping
                const notes = row.notes || row.Notes || '';
                
                // Cost mapping
                const costPerMl = row.costPerML || row.cost_per_ml || undefined;
                
                return {
                  name: company ? `${rawName} (${company})` : rawName,
                  volumeMl: volume,
                  notes: notes,
                  costPerMl: costPerMl
                };
              });
              
              const sanitized = sanitizeItems(flavors);
              if (sanitized.length > 0) {
                const count = onImport(sanitized);
                setSuccessCount(count);
              } else {
                setError("No valid flavors found in the file.");
              }
              setIsLoading(false);
            },
            error: (err) => {
              console.error("CSV parse error:", err);
              setError("Failed to parse CSV file.");
              setIsLoading(false);
            }
          });
          return;
        } else {
          throw new Error("Unsupported file format. Please use JSON for ATF or CSV for ELR.");
        }

        const sanitized = sanitizeItems(rawFlavors);
        if (sanitized.length > 0) {
          const count = onImport(sanitized);
          setSuccessCount(count);
        } else {
          setError("No valid flavors found in the file.");
        }
      } catch (err: any) {
        setError(err.message || "Failed to read file.");
      } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setError("Failed to read file.");
      setIsLoading(false);
    };

    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      onOpenChange(val);
      if (!val) {
        setSuccessCount(null);
        setError(null);
      }
    }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import Flavor Stash</DialogTitle>
          <DialogDescription>
            Import your flavor stash from All The Flavors (JSON) or E-Liquid Recipes (CSV).
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-2">
              <Button 
                variant="outline" 
                className="h-20 flex-col gap-2 border-dashed border-neutral-300 dark:border-neutral-700"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded-lg">
                    <FileDown className="w-5 h-5 text-green-600" />
                  </div>
                </div>
                <span className="text-xs font-semibold">Select JSON (ATF) or CSV (ELR)</span>
              </Button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept=".json,.csv" 
                className="hidden" 
              />
            </div>

            {isLoading && (
              <div className="flex items-center justify-center py-4">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 rounded-lg flex items-start gap-2 text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-xs">{error}</p>
              </div>
            )}

            {successCount !== null && (
              <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900 rounded-lg flex items-start gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold mb-1">Import Successful!</p>
                  <p>Added {successCount} new flavors to your stash.</p>
                  {successCount === 0 && <p className="italic mt-1 opacity-70">All flavors in the file were already in your inventory.</p>}
                </div>
              </div>
            )}

            <div className="text-[10px] text-neutral-400 space-y-1 bg-neutral-50 dark:bg-neutral-900/50 p-2 rounded border border-neutral-100 dark:border-neutral-800">
              <p className="font-bold uppercase tracking-wider">How to export:</p>
              <p>• <strong>ATF:</strong> Profile → Backup Data → Flavor Stash → JSON</p>
              <p>• <strong>ELR:</strong> User → My Flavor Stash → Export to csv</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {successCount !== null ? 'Done' : 'Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

