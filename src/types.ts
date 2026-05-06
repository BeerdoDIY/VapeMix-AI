export interface Flavor {
  id: string;
  name: string;
  percentage: number;
  costPerMl?: number;
  originalName?: string;
  isSubstitution?: boolean;
  notes?: string;
  safetyWarnings?: string[];
}

export interface Recipe {
  id: string;
  name: string;
  category?: string;
  servingMl: number;
  targetNicMg: number;
  targetPgRatio: number; // e.g., 40 for 40/60 PG/VG
  nicBaseMg: number;
  nicBaseType: 'PG' | 'VG';
  nicBasePgRatio?: number; // 0 to 100
  flavors: Flavor[];
  createdAt: number;
  updatedAt: number;
  lastMixedAt?: number;
  mixCount?: number;
  rating?: number;
  source?: 'manual' | 'import' | 'ai';
  steepingDays?: number;
  description?: string;
  uid?: string;
}

export interface CalculationResult {
  nicotineMl: number;
  nicotineGrams: number;
  pgMl: number;
  pgGrams: number;
  vgMl: number;
  vgGrams: number;
  flavorResults: {
    id: string;
    name: string;
    ml: number;
    grams: number;
    percentage: number;
  }[];
  totalMl: number;
  totalGrams: number;
  totalCost: number;
}

export interface IngredientCost {
  nicCostPerMl: number;
  pgCostPerMl: number;
  vgCostPerMl: number;
  bottleCost: number;
}

export interface UserSettings {
  defaultNicBaseMg: number;
  defaultNicBaseType: 'PG' | 'VG';
  defaultNicBasePgRatio?: number; // 0 to 100
  defaultTargetPgRatio: number;
  defaultServingMl: number;
  defaultTargetNicMg: number;
  geminiApiKey?: string;
  mixingPreference?: 'weight' | 'volume';
  lowStockThreshold: number;
  theme?: 'light' | 'dark' | 'system';
  acknowledgedSafety?: boolean;
  pgDensity?: number;
  vgDensity?: number;
  aiCustomInstructions?: string;
}

export interface InventoryFlavor {
  id?: string;
  name: string;
  costPerMl?: number;
  volumeMl?: number;
  notes?: string;
  uid?: string;
  safetyWarnings?: string[];
}

export interface ShoppingItem {
  id: string;
  name: string;
  addedAt: number;
  uid?: string;
}

export interface OrderItem {
  id: string;
  name: string;
  volumeMl: number;
  price: number;
}

export interface Order {
  id: string;
  orderNumber?: string;
  vendor?: string;
  items: OrderItem[];
  shippingCost: number;
  currency: string;
  totalCost: number;
  status: 'pending' | 'received';
  createdAt: number;
  receivedAt?: number;
  uid: string;
}

export interface Mix {
  id: string;
  recipeId: string;
  recipeName: string;
  mixedAt: number;
  totalVolume: number;
  targetPgRatio: number;
  targetNicMg: number;
  flavorIntensity?: number;
  flavors: {
    id: string;
    name: string;
    originalName?: string;
    percentage: number;
    ml: number;
    isSubstitution?: boolean;
    safetyWarnings?: string[];
  }[];
  steepingDays?: number;
  rating?: number;
  notes?: string;
  uid: string;
}
