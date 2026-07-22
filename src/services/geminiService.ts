import { auth } from '../lib/firebase';

export interface FeedbackRecipe {
  name: string;
  flavors: { name: string; percentage: number }[];
  rating: number;
  description?: string;
}

export interface SubstitutionSuggestion {
  name: string;
  multiplier: number;
  rationale: string;
}

export function resetGeminiService() {
  // Configured on server-side now, no-op on client side for interface compatibility.
}

/**
 * Helper to build headers containing the optional custom user API key.
 */
function getHeaders(userApiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const trimmed = userApiKey ? userApiKey.trim() : "";
  if (trimmed) {
    headers["x-gemini-api-key"] = trimmed;
  }
  try {
    const email = auth.currentUser?.email;
    if (email) {
      headers["x-user-email"] = email.trim();
    }
  } catch (e) {
    // Ignore error
  }
  return headers;
}

export async function suggestRecipes(
  availableFlavors: string[], 
  preferences?: string, 
  userApiKey?: string,
  customInstructions?: string,
  highRatedRecipes: FeedbackRecipe[] = [],
  lowRatedRecipes: FeedbackRecipe[] = [],
  allowOutOfStash: boolean = true
) {
  const isUS = typeof navigator !== 'undefined' && navigator.language === 'en-US';
  
  if (!availableFlavors.length && !allowOutOfStash) return [];

  const response = await fetch("/api/suggest-recipes", {
    method: "POST",
    headers: getHeaders(userApiKey),
    body: JSON.stringify({
      availableFlavors,
      preferences,
      customInstructions,
      highRatedRecipes,
      lowRatedRecipes,
      allowOutOfStash,
      isUS
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Unknown backend error" }));
    throw new Error(errorData.error || `Server error suggestions: ${response.status}`);
  }

  return await response.json();
}

export async function parseImportedRecipe(
  content: string, 
  userApiKey?: string, 
  defaults?: { servingMl?: number, targetNicMg?: number, targetPgRatio?: number }
) {
  const isUS = typeof navigator !== 'undefined' && navigator.language === 'en-US';

  const response = await fetch("/api/parse-recipe", {
    method: "POST",
    headers: getHeaders(userApiKey),
    body: JSON.stringify({
      content,
      defaults,
      isUS
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Unknown backend error" }));
    throw new Error(errorData.error || `Server error parsing recipe: ${response.status}`);
  }

  return await response.json();
}

export async function parseInvoice(content: string, userApiKey?: string) {
  const isUS = typeof navigator !== 'undefined' && navigator.language === 'en-US';

  const response = await fetch("/api/parse-invoice", {
    method: "POST",
    headers: getHeaders(userApiKey),
    body: JSON.stringify({
      content,
      isUS
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: "Unknown backend error" }));
    throw new Error(errorData.error || `Server error parsing invoice: ${response.status}`);
  }

  return await response.json();
}

export async function getAiSubstitutions(
  targetFlavor: string,
  targetPercentage: number,
  inventory: string[],
  recipeName?: string,
  allRecipeFlavors?: { name: string, percentage: number }[],
  userApiKey?: string
): Promise<SubstitutionSuggestion[]> {
  const isUS = typeof navigator !== 'undefined' && navigator.language === 'en-US';

  try {
    const response = await fetch("/api/get-substitutions", {
      method: "POST",
      headers: getHeaders(userApiKey),
      body: JSON.stringify({
        targetFlavor,
        targetPercentage,
        inventory,
        recipeName,
        allRecipeFlavors,
        isUS
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown backend error" }));
      console.error("AI Substitution Server Error:", errorData.error);
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to fetch AI substitutions from server:", error);
    return [];
  }
}
