/**
 * Utility for detecting potentially harmful components in flavourings.
 * This is based on common e-liquid flavouring industry knowledge (DAAP - Diacetyl, Acetyl Propionyl, Acetoin).
 */

interface BrandSafetyInfo {
  keywords: string[];
  warning: string;
}

const SAFETY_RULES: BrandSafetyInfo[] = [
  {
    keywords: ["Custard", "Vanilla Bean Ice Cream", "VBIC", "Caramel", "Butter", "Popcorn", "Cream"],
    warning: "May contain Diacetyl, Acetyl Propionyl, or Acetoin (DAAP)."
  },
  {
    keywords: ["Sweetener", "Sucralose"],
    warning: "Known to produce harmful compounds when heated above 250°C."
  },
  {
    keywords: ["Cinnamon", "Red Hot"],
    warning: "May contain Cinnamaldehyde, which can be irritating to airways."
  },
  {
    keywords: ["Ethyl Maltol"],
    warning: "Flavour enhancer that may increase addictive potential or alter absorption."
  }
];

/**
 * Checks a flavour name for potential safety concerns.
 * @param flavorName The full name of the flavour (e.g., "Vanilla Bean Ice Cream (CAP)")
 * @returns An array of warning strings if any concern is found.
 */
export function getSafetyWarnings(flavorName: string): string[] {
  const warnings: string[] = [];
  const normalized = flavorName.toLowerCase();

  // Special cases for "DX" or "V2" versions which are usually DAAP-free
  if (normalized.includes(" dx ") || normalized.includes(" v2 ") || normalized.includes(" (dx)") || normalized.includes(" (v2)")) {
    return [];
  }

  // Check against our rule-set
  for (const rule of SAFETY_RULES) {
    if (rule.keywords.some(k => normalized.includes(k.toLowerCase()))) {
      warnings.push(rule.warning);
    }
  }

  return warnings;
}

/**
 * Checks if a flavour's percentage exceeds recommended "pleasant" thresholds for potent ingredients.
 * @param flavorName The full name of the flavour
 * @param percentage The suggested percentage in the recipe
 * @returns A warning string if the percentage is considered high, or null.
 */
export function getPotencyWarning(flavorName: string, percentage: number): string | null {
  const normalized = flavorName.toLowerCase().replace(/[^a-z0-9 ]/g, ''); // Strip hyphens/punctuation for matching
  
  const potentFlavors = [
    { keys: ['ws23', 'ws 23'], name: 'WS-23', threshold: 1.5 },
    { keys: ['koolada'], name: 'Koolada', threshold: 1.5 },
    { keys: ['super sweet'], name: 'Super Sweet', threshold: 1.0 },
    { keys: ['sweetener'], name: 'Sweetener', threshold: 2.0 },
    { keys: ['flavorah', 'flv'], name: 'Flavorah / FLV', threshold: 2.0 },
    { keys: ['medicine flower', 'mf'], name: 'Medicine Flower', threshold: 1.0 },
  ];

  for (const item of potentFlavors) {
    if (item.keys.some(k => normalized.includes(k))) {
      if (percentage >= item.threshold) {
        return `The high percentage of ${item.name} (${percentage}%) in this recipe may be unpleasant or extremely harsh.`;
      }
    }
  }
  return null;
}

/**
 * Formats safety warnings for UI display.
 */
export function formatSafetyWarnings(warnings: string[]): string {
  if (!warnings || warnings.length === 0) return "";
  return warnings.join(" ");
}
