import { GoogleGenAI, Type } from "@google/genai";

let cachedApiKey: string | null = null;

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
  lowRatedRecipes: FeedbackRecipe[] = []
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
  
  if (!availableFlavors.length) return [];

  let prompt = `You are an expert e-liquid mixologist with deep knowledge of DIY ${flavorWord}ing concentrates and their typical usage percentages.
  
  I have the following e-liquid ${flavorsWord} available in my stash: ${availableFlavors.join(', ')}. 
  Suggest 3 creative and delicious e-liquid recipes I can make using ONLY these ${flavorsWord}. 
  For each recipe, provide a name, a brief description of the ${flavorWord} profile, a recommended steeping time in days, and the suggested percentage for each ingredient.

  EXPERT MIXING GUIDELINES:
  - Be realistic with percentages. Most recipes should have a total ${flavorWord} content between 8% and 20%.
  - Recognize "Super Concentrates" and potent additives. For example:
    * WS-23, Koolada, and Super Sweet (CAP) are usually used at 0.05% - 1.5%. NEVER suggest 3.5% WS-23; it would be unvapable and extremely harsh.
    * Brands like Flavorah (FLV) and Medicine Flower usually require much lower percentages (0.1% - 1.5%) compared to TFA or Capella (3% - 8%).
  - Differentiate between primary notes (highest %), bridge notes, and background accents (lowest %).
  - If a ${flavorWord} is known to be very strong, use it sparingly as a background note.
  - If a user explicitly asks for an unusually high percentage of a known potent ${flavorWord} (e.g. "5% WS-23"), follow the instruction but include a clear caution in the description field stating that this level is very high and may be unpleasant.
  - steepingDays should be realistic (Fruits: 1-3 days, Creams/Custards: 7-14/21 days, Tobaccos: 14-30 days).

  INVENTIVENESS & LEARNING (CRITICAL):
  - ANALYZE the provided HIGH-RATED recipes to understand the "User's Palate" (e.g., preference for complex bakeries, simple fruits, specific cooling levels).
  - DO NOT just suggest similar recipes to high-rated ones; be INVENTIVE while respecting the palate.
  - ANALYZE the provided LOW-RATED recipes (1-2 stars) to understand what the user DOES NOT like.
  - AVOID combinations, flavor profiles, or specific high percentages that resulted in low ratings. Use this to learn "Off-Notes" the user is sensitive to.

  PLEASE USE ${isUS ? 'US' : 'COMMONWEALTH'} SPELLING (e.g. use "${flavorWord}") appearing in your responses.`;

  if (highRatedRecipes && highRatedRecipes.length > 0) {
    prompt += `\n\nUSER'S TOP-RATED RECIPES (LEARN FROM THESE):\n`;
    highRatedRecipes.forEach(r => {
      const flavors = r.flavors.map(f => `${f.name} (${f.percentage}%)`).join(', ');
      prompt += `- ${r.name} (Rating: ${r.rating}/5): ${flavors}. Notes: ${r.description || 'None'}\n`;
    });
  }

  if (lowRatedRecipes && lowRatedRecipes.length > 0) {
    prompt += `\n\nUSER'S LOW-RATED RECIPES (AVOID THESE PATTERNS):\n`;
    lowRatedRecipes.forEach(r => {
      const flavors = r.flavors.map(f => `${f.name} (${f.percentage}%)`).join(', ');
      prompt += `- ${r.name} (Rating: ${r.rating}/5): ${flavors}. Notes: ${r.description || 'None'}\n`;
    });
  }

  if (preferences && preferences.trim()) {
    prompt += `\n\nUser Preferences: ${preferences.trim()}\nPlease try to follow these preferences while still ONLY using the available flavors listed above.`;
  }

  if (customInstructions && customInstructions.trim()) {
    prompt += `\n\nADDITIONAL USER-SPECIFIC RULES (PRIORITIZE THESE):\n${customInstructions.trim()}`;
  }

  try {
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              steepingDays: { type: Type.NUMBER },
              flavors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    percentage: { type: Type.NUMBER }
                  },
                  required: ["name", "percentage"]
                }
              }
            },
            required: ["name", "description", "flavors", "steepingDays"]
          }
        }
      }
    });

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

export async function parseImportedRecipe(content: string, userApiKey?: string) {
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
  
  If some values are missing but a recipe is clearly present, use sensible defaults (e.g., 60ml, 3mg nic, 30/70 PG/VG).
  
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
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
    });

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
    const result = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
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
    });

    const text = result.text;
    if (!text) throw new Error("Gemini returned empty text");
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Error parsing invoice:", error);
    throw error;
  }
}
