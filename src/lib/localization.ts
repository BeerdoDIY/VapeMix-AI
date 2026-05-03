/**
 * Simple localization helper for Commonwealth vs. US English spellings.
 * Currently supports 'flavor' vs 'flavour'.
 */
const isUSLocale = (): boolean => {
  if (typeof navigator === 'undefined') return true; // Default to US for SSR if server-authoritative
  
  // Check navigator.languages first (more accurate)
  if (navigator.languages && navigator.languages.length > 0) {
    return navigator.languages[0] === 'en-US';
  }
  
  return navigator.language === 'en-US';
};

/**
 * Returns 'flavor' or 'flavour' based on user locale.
 */
export const flavor = (capitalize = false): string => {
  const word = isUSLocale() ? 'flavor' : 'flavour';
  if (capitalize) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
};

/**
 * Returns 'flavoring' or 'flavouring' based on user locale.
 */
export const flavoring = (capitalize = false): string => {
  const word = isUSLocale() ? 'flavoring' : 'flavouring';
  if (capitalize) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
};

/**
 * Returns 'flavors' or 'flavours' based on user locale.
 */
export const flavors = (capitalize = false): string => {
  const word = isUSLocale() ? 'flavors' : 'flavours';
  if (capitalize) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
};
