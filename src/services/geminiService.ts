import { GoogleGenAI, Type } from "@google/genai";

let cachedApiKey: string | null = null;

/**
 * Helper to call a Gemini API function with retries on transient errors.
 * Retries on 429 (rate limits) and 503 (service unavailable / high demand).
 */
async function callWithRetry<T>(
  apiCall: () => Promise<T>,
  retries = 3,
  delayMs = 1200
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await apiCall();
    } catch (error: any) {
      attempt++;
      
      const errorMessage = error?.message || "";
      const errorStatus = error?.status || "";
      const errorCode = error?.code || error?.status || "";
      
      let stringifiedError = "";
      try {
        stringifiedError = JSON.stringify(error);
      } catch (e) {
        stringifiedError = String(error);
      }

      const isTransient = 
        errorMessage.includes("503") ||
        errorMessage.includes("UNAVAILABLE") ||
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.includes("high demand") ||
        errorMessage.includes("temporary") ||
        stringifiedError.includes("503") ||
        stringifiedError.includes("UNAVAILABLE") ||
        stringifiedError.includes("429") ||
        stringifiedError.includes("RESOURCE_EXHAUSTED") ||
        stringifiedError.includes("high demand") ||
        errorCode === 503 ||
        errorCode === 429 ||
        errorStatus === "UNAVAILABLE" ||
        errorStatus === "RESOURCE_EXHAUSTED";

      if (attempt >= retries || !isTransient) {
        throw error;
      }

      console.warn(`[Gemini Service] Call failed (attempt ${attempt}/${retries}). Transient error detected. Retrying in ${delayMs}ms... Error:`, error);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2; // Exponential backoff
    }
  }
}

export function resetGeminiService() {
  cachedApiKey = null;
}

async function getApiKey(userApiKey?: string) {
  if (userApiKey && userApiKey.length >= 10) return userApiKey;
  if (cachedApiKey) return cachedApiKey;
  
  // Try to get from localStorage (manual troubleshooting fallback)
  const manualKey = localStorage.getItem('manual_gemini_api_key');
  if (manualKey) {
    cachedApiKey = manualKey;
    return cachedApiKey;
  }

  // Try to get from process.env (injected at build time or by picker)
  const envKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (envKey && envKey !== "MY_GEMINI_API_KEY" && envKey !== "undefined") {
    cachedApiKey = envKey;
    return cachedApiKey;
  }

  // Fetch from server at runtime (reliable for shared apps)
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (config.GEMINI_API_KEY) {
      cachedApiKey = config.GEMINI_API_KEY;
      return cachedApiKey;
    }
  } catch (e) {
    console.error("Failed to fetch runtime config:", e);
  }

  return null;
}

export interface FeedbackRecipe {
  name: string;
  flavors: { name: string; percentage: number }[];
  rating: number;
  description?: string;
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
  const flavorWord = isUS ? 'flavor' : 'flavour';
  const flavorsWord = isUS ? 'flavors' : 'flavours';

  const apiKey = await getApiKey(userApiKey);
  
  if (!apiKey || apiKey === "undefined" || apiKey === "" || apiKey.length < 10) {
    const keyHint = apiKey ? `(Detected: ${apiKey.substring(0, 4)}...)` : "(Not detected)";
    throw new Error(`Gemini API Key is invalid or missing ${keyHint}. Please check your project settings.`);
  }

  const ai = new GoogleGenAI({ apiKey });
  
  if (!availableFlavors.length && !allowOutOfStash) return [];

  let prompt = `You are "The Master Mixologist," an expert e-liquid artisan with decades of experience in ${flavorWord} chemistry and profile balancing. Your goal is to create recipes that aren't just functional, but award-winning.

### YOUR DESIGN PHILOSOPHY:
1. **Bridge Notes:** You use specific ${flavorsWord} to bridge the gap between top and base notes (e.g., using a touch of Dragonfruit to make Strawberry pop).
2. **Texture & Mouthfeel:** You consider how ingredients like Marshmallow, Meringue, or Ethyl Maltol affect the "thickness" of the vapor.
3. **Chemical Realism:** You respect the "Total ${flavorWord.charAt(0).toUpperCase() + flavorWord.slice(1)} %" ceiling. Unless requested otherwise, keep total ${flavorWord} between 8-15% to avoid over-saturation and muting.
4. **Steep Awareness:** You understand that creams and custards need time. You will advise the user on the optimal steep time.

### MANDATORY USER PREFERENCE & PROFILE MANDATE (CRITICAL):
- If the user specifies specific flavours, ingredients, fruits, or profiles in their prompt or preferences (for example, "watermelon, apple and peach"), **ALL OF THEM MUST BE INCLUDED AND FULLY REPRESENTED in EVERY single one of the 3 generated recipes.**
- You must NOT omit or leave out any of the requested flavour elements. For example, if watermelon, apple, and peach are requested, every single result must contain ingredients representing watermelon, apple, and peach.
- User-requested profiles are the absolute highest priority. Do NOT ignore or leave them out in favor of repeating old top-rated recipe formats.

### BALANCE WITH RATINGS (HIGH vs. LOW):
- ANALYZE the provided HIGH-RATED recipes to understand the "User's Palate" (preferred overall intensity, sweetness, cream/custard preference or style), and LOW-RATED recipes to avoid what the user dislikes (like high sweetener%).
- **DO NOT OVER-RELY ON PREVIOUS RECIPES:** Do NOT let previous recipes override or dilute the currently requested flavour profile. The user's active prompt is the definitive instruction. If the requested profile differs from previous ratings, prioritize the new profile completely.

### TECHNICAL CONSTRAINTS:
- You will be provided with a [USER_STASH] (JSON array of available ${flavorsWord}). 
- You MUST prioritize ${flavorsWord} found in the [USER_STASH]: ${availableFlavors.join(', ')}.
- ${allowOutOfStash ? 'If a recipe requires a "crucial" ' + flavorWord + ' not in the stash, suggest it as a "Recommended Addition" and mark it as "inStash: false".' : 'You MUST ONLY use ' + flavorsWord + ' that are in the [USER_STASH]. Do NOT suggest any ' + flavorsWord + ' the user does not have.'}
- RECOGNIZE potent additives: WS-23, Koolada, and Super Sweet (CAP) are usually used at 0.05% - 1.5%.
- ALWAYS output exactly 3 recipes in a strictly valid JSON format matching the requested schema.
- PLEASE USE COMMONWEALTH SPELLING (e.g. use "${flavorWord}") appearing in your responses.

### THE PROCESS (Chain of Thought):
Before providing the JSON, internally evaluate the requested profile. Ask: "Did I include EVERY single flavour, fruit, or ingredient the user requested in their active prompt? How do I make them balance perfectly?" Then, generate the output.

INVENTIVENESS & EXPLORATION:
- **DIVERSITY & INNOVATION:** Do not just repeat existing high-rated patterns. Encourage trying something new from their stash.
- **UNEXPLORED FLAVOURS:** Look for flavours in the [USER_STASH] that appear in fewer of the high-rated recipes and try to feature them in a balanced, expert way.
- **VARIED SUGGESTIONS:** When providing 3 recipes, ensure they represent different profiles (e.g. one "Safe" refinement, one "Adventurous" shift, and one "Complex" exploration).`;

  if (highRatedRecipes && highRatedRecipes.length > 0) {
    prompt += `\n\nUSER'S TOP-RATED RECIPES (LEARN FROM THIS STYLE AND PALATE, BUT DO NOT DILUTE THE ACTIVE USER PREFERENCE WITH THESE):\n`;
    highRatedRecipes.forEach(r => {
      const flavors = r.flavors.map(f => `${f.name} (${f.percentage}%)`).join(', ');
      prompt += `- ${r.name} (Rating: ${r.rating}/5): ${flavors}. Notes: ${r.description || 'None'}\n`;
    });
  }

  if (lowRatedRecipes && lowRatedRecipes.length > 0) {
    prompt += `\n\nUSER'S LOW-RATED RECIPES (AVOID THESE STYLES OR INGREDIENT RATIOS):\n`;
    lowRatedRecipes.forEach(r => {
      const flavors = r.flavors.map(f => `${f.name} (${f.percentage}%)`).join(', ');
      prompt += `- ${r.name} (Rating: ${r.rating}/5): ${flavors}. Notes: ${r.description || 'None'}\n`;
    });
  }

  if (preferences && preferences.trim()) {
    prompt += `\n\nUser Preferences & Active Request: ${preferences.trim()}\nIMPORTANT: EVERY single one of the 3 generated recipes MUST completely satisfy these active preferences and include all requested flavor components. Do not let previous high/low recipes distract from these.`;
  }

  if (customInstructions && customInstructions.trim()) {
    prompt += `\n\nADDITIONAL USER-SPECIFIC RULES (PRIORITIZE THESE):\n${customInstructions.trim()}`;
  }

  try {
    const result = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              recipeName: { type: Type.STRING },
              description: { type: Type.STRING },
              steepTimeDays: { type: Type.NUMBER },
              rationale: { type: Type.STRING },
              ingredients: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    percentage: { type: Type.NUMBER },
                    inStash: { type: Type.BOOLEAN }
                  },
                  required: ["name", "percentage", "inStash"]
                }
              }
            },
            required: ["recipeName", "description", "ingredients", "steepTimeDays", "rationale"]
          }
        }
      }
    }));

    const text = result.text;
    if (!text) {
      console.error("Gemini returned empty text");
      return [];
    }

    return JSON.parse(text);
  } catch (error: any) {
    console.error("Error suggesting recipes:", error);
    throw error;
  }
}

export async function parseImportedRecipe(
  content: string, 
  userApiKey?: string, 
  defaults?: { servingMl?: number, targetNicMg?: number, targetPgRatio?: number }
) {
  const apiKey = await getApiKey(userApiKey);
  
  if (!apiKey || apiKey === "undefined" || apiKey === "" || apiKey.length < 10) {
    throw new Error("Gemini API Key is invalid or missing. Please check your project settings.");
  }

  const isUS = typeof navigator !== 'undefined' && navigator.language === 'en-US';
  const flavorWord = isUS ? 'flavor' : 'flavour';

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `You are an expert e-liquid recipe parser. I will provide you with text or HTML content from an e-liquid recipe website (like All The Flavors or E-Liquid Recipes). 
  Extract the recipe details and return them in the following JSON format:
  {
    "recipeFound": boolean,
    "name": "Recipe Name",
    "description": "Short description or notes about the recipe",
    "category": "Fruit/Tobacco/Dessert/Candy/Custard/Ice/Beverage/Bakery/Other",
    "servingMl": number,
    "targetNicMg": number,
    "targetPgRatio": number (PG percentage, e.g. 30),
    "steepingDays": number,
    "flavors": [
      { 
        "name": "${flavorWord.charAt(0).toUpperCase() + flavorWord.slice(1)} Name (Manufacturer)", 
        "percentage": number,
        "safetyWarnings": ["Warning about Diacetyl, Acetoin, or other harmful components if detected"]
      }
    ]
  }
  
  CRITICAL SAFETY CHECK: For each ${flavorWord}, check if it is known to contain Diacetyl, Acetyl Propionyl (AP), or Acetoin. If you suspect it does (e.g., custards, buttery ${flavorWord}s, certain creams), include a brief warning in the "safetyWarnings" array.
  
  CRITICAL: If you cannot find a clear e-liquid recipe in the content (no ${flavorWord} list or percentages), set "recipeFound" to false. If you find a recipe, set it to true.
  
  If some values are missing but a recipe is clearly present, use these defaults:
  - Volume: ${defaults?.servingMl || 60}ml
  - Nicotine: ${defaults?.targetNicMg || 3}mg
  - PG/VG Ratio: ${defaults?.targetPgRatio || 30}/${100 - (defaults?.targetPgRatio || 30)} (So targetPgRatio = ${defaults?.targetPgRatio || 30})
  
  CRITICAL NAMING CONVENTION:
  Ensure ${flavorWord} names follow the format "${flavorWord.charAt(0).toUpperCase() + flavorWord.slice(1)} Name (Manufacturer Abbreviation)". 
  If the manufacturer is written in full at the start or end, move it to parentheses at the end as an abbreviation.
  Examples:
  - "${flavorWord.charAt(0).toUpperCase() + flavorWord.slice(1)} West Hazelnut" -> "Hazelnut (FW)"
  - "TFA Graham Cracker (Clear)" -> "Graham Cracker (Clear) (TFA)"
  - "Capella Vanilla Bean Ice Cream" -> "Vanilla Bean Ice Cream (CAP)"
  - "FlavourArt Fuji" -> "Fuji (FA)"
  - "Inawera Shisha Strawberry" -> "Shisha Strawberry (INW)"
  
  Common Abbreviations: TFA, CAP, FW, FA, INW, FLV, WF, JF, MB, RF.
  
  Content to parse:
  ${content.substring(0, 15000)} // Truncate to avoid token limits if it's a huge HTML`;

  try {
    const result = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recipeFound: { type: Type.BOOLEAN },
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING },
            servingMl: { type: Type.NUMBER },
            targetNicMg: { type: Type.NUMBER },
            targetPgRatio: { type: Type.NUMBER },
            steepingDays: { type: Type.NUMBER },
            flavors: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  percentage: { type: Type.NUMBER },
                  safetyWarnings: { 
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["name", "percentage"]
              }
            }
          },
          required: ["recipeFound", "name", "flavors"]
        }
      }
    }));

    const text = result.text;
    if (!text) throw new Error("Gemini returned empty text");
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Error parsing recipe:", error);
    throw error;
  }
}

export async function parseInvoice(content: string, userApiKey?: string) {
  const apiKey = await getApiKey(userApiKey);
  
  if (!apiKey || apiKey === "undefined" || apiKey === "" || apiKey.length < 10) {
    throw new Error("Gemini API Key is invalid or missing. Please check your project settings.");
  }

  const isUS = typeof navigator !== 'undefined' && navigator.language === 'en-US';
  const flavorWord = isUS ? 'flavor' : 'flavour';

  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `You are an expert invoice parser. I will provide you with text content from an invoice for e-liquid ${flavorWord}ing concentrates.
  Extract the items, vendor name, order number, and shipping costs. Return the data in the following JSON format:
  {
    "vendor": "Vendor Name",
    "orderNumber": "Order # or ID",
    "items": [
      {
        "name": "${flavorWord.charAt(0).toUpperCase() + flavorWord.slice(1)} Name (Manufacturer)",
        "volumeMl": number,
        "price": number,
        "safetyWarnings": ["Warning if component is potentially harmful"]
      }
    ],
    "shippingCost": number,
    "currency": "string (e.g. USD, GBP, EUR)"
  }
  
  CRITICAL: 
  - If you cannot find a vendor or order number, use "Unknown Vendor" or "Unknown Order".
  - Ensure ${flavorWord} names follow the format "${flavorWord.charAt(0).toUpperCase() + flavorWord.slice(1)} Name (Manufacturer Abbreviation)". 
    If the manufacturer is written in full at the start or end, move it to parentheses at the end as an abbreviation.
    Examples:
    - "${flavorWord.charAt(0).toUpperCase() + flavorWord.slice(1)} West Hazelnut" -> "Hazelnut (FW)"
    - "TFA Graham Cracker (Clear)" -> "Graham Cracker (Clear) (TFA)"
    - "Capella Vanilla Bean Ice Cream" -> "Vanilla Bean Ice Cream (CAP)"
    - "FlavourArt Fuji" -> "Fuji (FA)"
    - "Inawera Shisha Strawberry" -> "Shisha Strawberry (INW)"
  - Common Abbreviations: TFA, CAP, FW, FA, INW, FLV, WF, JF, MB, RF.
  - If volume is in liters, convert to ml (1L = 1000ml).
  - If multiple quantities of the same item are listed, combine them or list them separately, but ensure the price is the total for that line item or per unit (specify in your logic, but I prefer total price for the line item). Actually, let's aim for price per line item and volume per line item.
  - If you cannot find any items, return an empty items array.
  
  Content to parse:
  ${content.substring(0, 15000)}`;

  try {
    const result = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            vendor: { type: Type.STRING },
            orderNumber: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  volumeMl: { type: Type.NUMBER },
                  price: { type: Type.NUMBER },
                  safetyWarnings: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["name", "volumeMl", "price"]
              }
            },
            shippingCost: { type: Type.NUMBER },
            currency: { type: Type.STRING }
          },
          required: ["items", "shippingCost", "vendor", "orderNumber"]
        }
      }
    }));

    const text = result.text;
    if (!text) throw new Error("Gemini returned empty text");
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Error parsing invoice:", error);
    throw error;
  }
}

export interface SubstitutionSuggestion {
  name: string;
  multiplier: number;
  rationale: string;
}

export async function getAiSubstitutions(
  targetFlavor: string,
  targetPercentage: number,
  inventory: string[],
  recipeName?: string,
  allRecipeFlavors?: { name: string, percentage: number }[],
  userApiKey?: string
): Promise<SubstitutionSuggestion[]> {
  const apiKey = await getApiKey(userApiKey);
  if (!apiKey || apiKey.length < 10) return [];

  const isUS = typeof navigator !== 'undefined' && navigator.language === 'en-US';
  const flavorWord = isUS ? 'flavor' : 'flavour';
  const flavorsWord = isUS ? 'flavors' : 'flavours';

  const ai = new GoogleGenAI({ apiKey });

  let prompt = `You are "The Master Mixologist," an expert e-liquid artisan. 
  I need to find the best substitute for a missing ${flavorWord} in a recipe.
  
  MISSING ${flavorWord.toUpperCase()}: ${targetFlavor}
  INTENDED PERCENTAGE: ${targetPercentage}%
  ${recipeName ? `RECIPE NAME: ${recipeName}` : ''}
  ${allRecipeFlavors ? `OTHER ${flavorsWord.toUpperCase()} IN RECIPE: ${allRecipeFlavors.map(f => `${f.name} (${f.percentage}%)`).join(', ')}` : ''}
  
  [USER_STASH]: ${inventory.join(', ')}
  
  YOUR TASK:
  1. Analyze the profile of the missing ${flavorWord}.
  2. Search the [USER_STASH] for the closest possible matches in terms of profile (e.g., if "Strawberry (TFA)" is missing, "Strawberry (CAP)" or "Shisha Strawberry (INW)" might work).
  3. For each suggestion, provide a "multiplier" to adjust the percentage. Some ${flavorsWord} are much more concentrated than others (e.g., FlavourArt is usually stronger than TFA).
  4. Provide a brief rationale for why this is a good substitute.
  
  RULES:
  - ONLY suggest ${flavorsWord} that are in the [USER_STASH].
  - Suggest a maximum of 3 options.
  - Return the results in a strictly valid JSON format.
  - If NO good substitutes exist in the stash, return an empty array. Avoid suggesting things that are "worlds apart" (e.g., don't suggest a butter for a pineapple).
  `;

  try {
    const result = await callWithRetry(() => ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              multiplier: { type: Type.NUMBER },
              rationale: { type: Type.STRING }
            },
            required: ["name", "multiplier", "rationale"]
          }
        }
      }
    }));

    const text = result.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("Error getting AI substitutions:", error);
    return [];
  }
}
