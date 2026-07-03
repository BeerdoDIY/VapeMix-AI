import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";

// Load environment variables from .env if it exists
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

      console.warn(`[Server Gemini] Call failed (attempt ${attempt}/${retries}). Transient error detected. Retrying in ${delayMs}ms... Error:`, error);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2; // Exponential backoff
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const now = new Date().toISOString();
  
  console.log(`[${now}] [PID: ${process.pid}] Starting server in ${process.env.NODE_ENV || 'development'} mode...`);

  app.use(express.json());

  // API route to provide the Gemini API Key configuration state to the frontend
  app.get("/api/config", (req, res) => {
    const apiKey = 
      process.env.GEMINI_API_KEY || 
      process.env.VITE_GEMINI_API_KEY || 
      process.env.GOOGLE_API_KEY || 
      process.env.API_KEY ||
      "";
    
    res.json({ 
      isConfigured: !!apiKey
    });
  });

  // Server-side recipe suggestion endpoint
  app.post("/api/suggest-recipes", async (req, res) => {
    try {
      const {
        availableFlavors = [],
        preferences = "",
        customInstructions = "",
        highRatedRecipes = [],
        lowRatedRecipes = [],
        allowOutOfStash = true,
        isUS = false
      } = req.body;

      const userApiKey = req.headers["x-gemini-api-key"] as string || "";
      const apiKey = (userApiKey && userApiKey.length >= 10) 
        ? userApiKey 
        : process.env.GEMINI_API_KEY || process.env.API_KEY || "";

      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        return res.status(400).json({ error: "Gemini API Key is invalid or missing. Please check your project settings." });
      }

      const ai = new GoogleGenAI({ apiKey });

      const flavorWord = isUS ? 'flavor' : 'flavour';
      const flavorsWord = isUS ? 'flavors' : 'flavours';

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
        highRatedRecipes.forEach((r: any) => {
          const flavors = r.flavors.map((f: any) => `${f.name} (${f.percentage}%)`).join(', ');
          prompt += `- ${r.name} (Rating: ${r.rating}/5): ${flavors}. Notes: ${r.description || 'None'}\n`;
        });
      }

      if (lowRatedRecipes && lowRatedRecipes.length > 0) {
        prompt += `\n\nUSER'S LOW-RATED RECIPES (AVOID THESE STYLES OR INGREDIENT RATIOS):\n`;
        lowRatedRecipes.forEach((r: any) => {
          const flavors = r.flavors.map((f: any) => `${f.name} (${f.percentage}%)`).join(', ');
          prompt += `- ${r.name} (Rating: ${r.rating}/5): ${flavors}. Notes: ${r.description || 'None'}\n`;
        });
      }

      if (preferences && preferences.trim()) {
        prompt += `\n\nUser Preferences & Active Request: ${preferences.trim()}\nIMPORTANT: EVERY single one of the 3 generated recipes MUST completely satisfy these active preferences and include all requested flavor components. Do not let previous high/low recipes distract from these.`;
      }

      if (customInstructions && customInstructions.trim()) {
        prompt += `\n\nADDITIONAL USER-SPECIFIC RULES (PRIORITIZE THESE):\n${customInstructions.trim()}`;
      }

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
        return res.json([]);
      }
      return res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("[Server Gemini] Error suggesting recipes:", error);
      return res.status(500).json({ error: error.message || "Failed to generate recipes." });
    }
  });

  // Server-side recipe parser endpoint
  app.post("/api/parse-recipe", async (req, res) => {
    try {
      const { content, defaults, isUS = false } = req.body;
      const userApiKey = req.headers["x-gemini-api-key"] as string || "";
      const apiKey = (userApiKey && userApiKey.length >= 10) 
        ? userApiKey 
        : process.env.GEMINI_API_KEY || process.env.API_KEY || "";

      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        return res.status(400).json({ error: "Gemini API Key is invalid or missing. Please check your project settings." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const flavorWord = isUS ? 'flavor' : 'flavour';

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
  ${content.substring(0, 15000)}`;

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
      return res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("[Server Gemini] Error parsing recipe:", error);
      return res.status(500).json({ error: error.message || "Failed to parse recipe." });
    }
  });

  // Server-side invoice parser endpoint
  app.post("/api/parse-invoice", async (req, res) => {
    try {
      const { content, isUS = false } = req.body;
      const userApiKey = req.headers["x-gemini-api-key"] as string || "";
      const apiKey = (userApiKey && userApiKey.length >= 10) 
        ? userApiKey 
        : process.env.GEMINI_API_KEY || process.env.API_KEY || "";

      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        return res.status(400).json({ error: "Gemini API Key is invalid or missing. Please check your project settings." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const flavorWord = isUS ? 'flavor' : 'flavour';

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
      return res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("[Server Gemini] Error parsing invoice:", error);
      return res.status(500).json({ error: error.message || "Failed to parse invoice." });
    }
  });

  // Server-side substitution recommender endpoint
  app.post("/api/get-substitutions", async (req, res) => {
    try {
      const { targetFlavor, targetPercentage, inventory = [], recipeName = "", allRecipeFlavors = [], isUS = false } = req.body;
      const userApiKey = req.headers["x-gemini-api-key"] as string || "";
      const apiKey = (userApiKey && userApiKey.length >= 10) 
        ? userApiKey 
        : process.env.GEMINI_API_KEY || process.env.API_KEY || "";

      if (!apiKey || apiKey === "undefined" || apiKey.length < 10) {
        return res.status(400).json({ error: "Gemini API Key is invalid or missing. Please check your project settings." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const flavorWord = isUS ? 'flavor' : 'flavour';
      const flavorsWord = isUS ? 'flavors' : 'flavours';

      // Advanced semantic and lexical pre-filtering to prevent over-loading Gemini and ensure instant response
      const preFilterInventory = (target: string, stash: string[]): string[] => {
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
        const targetNorm = norm(target);
        
        const cleanFlavorName = (name: string) => {
          return name.toLowerCase()
            .replace(/\((tfa|cap|fa|inw|fw|flv|vt|wf|la|tpa|capella|flavourart|flavorah|flavor west|inawera|wonder flavours|vape train)\)/g, '')
            .replace(/[^a-z0-9\s]/g, ' ')
            .trim();
        };

        const targetClean = cleanFlavorName(target);
        const targetWords = targetClean.split(/\s+/).filter(w => w.length >= 3 && !['and', 'the', 'with', 'v1', 'v2', 'v3'].includes(w));

        const groups = {
          creamy: ['cream', 'custard', 'milk', 'yogurt', 'butter', 'pudding', 'cheesecake', 'bavarian', 'sweetener', 'marshmallow', 'vanilla', 'caramel', 'toffee', 'chocolate', 'donut', 'cookie', 'cake', 'pie', 'graham', 'crust', 'sweet', 'marsh'],
          fruit: ['strawberry', 'apple', 'banana', 'blueberry', 'raspberry', 'peach', 'mango', 'pineapple', 'grape', 'lemon', 'lime', 'orange', 'citrus', 'cherry', 'watermelon', 'melon', 'coconut', 'pear', 'apricot', 'berry', 'berries', 'pomegranate', 'blackberry', 'kiwi', 'passion', 'fruit', 'nectarine', 'plum', 'grapefruit'],
          menthol: ['menthol', 'mint', 'ws-23', 'cooling', 'ice', 'polar', 'frost', 'ws23', 'koolada', 'spearmint', 'peppermint', 'wintergreen'],
          tobacco: ['tobacco', 'ry4', 'virginia', 'cigar', 'pipe', 'turkish', 'burley', 'latakia', 'shade', 'western'],
          beverage: ['coffee', 'tea', 'cola', 'soda', 'lemonade', 'bourbon', 'rum', 'whiskey', 'champagne', 'drink', 'beer', 'espresso']
        };

        const targetGroups: string[] = [];
        for (const [groupName, keywords] of Object.entries(groups)) {
          if (keywords.some(kw => targetNorm.includes(kw))) {
            targetGroups.push(groupName);
          }
        }

        const tier1: string[] = [];
        const tier2: string[] = [];
        const tier3: string[] = [];

        for (const item of stash) {
          const itemNorm = norm(item);
          const itemClean = cleanFlavorName(item);
          const itemWords = itemClean.split(/\s+/);

          const sharesWord = targetWords.some(tw => itemWords.some(iw => iw.includes(tw) || tw.includes(iw)));
          if (sharesWord) {
            tier1.push(item);
            continue;
          }

          const inSameGroup = targetGroups.some(gName => {
            const gKws = groups[gName as keyof typeof groups];
            return gKws.some(kw => itemNorm.includes(kw));
          });
          if (inSameGroup) {
            tier2.push(item);
            continue;
          }

          tier3.push(item);
        }

        const combined = [...tier1, ...tier2];
        if (combined.length < 15 && stash.length > combined.length) {
          const needed = 15 - combined.length;
          combined.push(...tier3.slice(0, needed));
        }

        return combined.slice(0, 40);
      };

      const filteredStash = preFilterInventory(targetFlavor, inventory);

      const prompt = `You are "The Master Mixologist," an expert e-liquid artisan. 
  I need to find the best substitute for a missing ${flavorWord} in a recipe from my stash.
  
  MISSING ${flavorWord.toUpperCase()}: ${targetFlavor}
  INTENDED PERCENTAGE: ${targetPercentage}%
  ${recipeName ? `RECIPE NAME: ${recipeName}` : ''}
  ${allRecipeFlavors ? `OTHER ${flavorsWord.toUpperCase()} IN RECIPE: ${allRecipeFlavors.map((f: any) => `${f.name} (${f.percentage}%)`).join(', ')}` : ''}
  
  [USER_STASH] (Pre-filtered candidate list): ${filteredStash.join(', ')}
  
  YOUR TASK:
  1. Analyze the profile of the missing ${flavorWord}.
  2. Search the [USER_STASH] for the closest possible matches in terms of profile.
  3. For each suggestion, provide a "multiplier" to adjust the percentage.
  4. Provide a brief rationale for why this is a good substitute.
  
  RULES:
  - ONLY suggest ${flavorsWord} that are in the [USER_STASH] list.
  - Suggest a maximum of 3 options.
  - **CRITICAL**: Keep each rationale extremely short (at most 1 brief, direct sentence) to guarantee ultra-fast response times.
  - Return the results in a strictly valid JSON format.
  - If NO good substitutes exist in the stash, return an empty array.
  `;

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
      if (!text) return res.json([]);
      return res.json(JSON.parse(text));
    } catch (error: any) {
      console.error("[Server Gemini] Error getting AI substitutions:", error);
      return res.status(500).json({ error: error.message || "Failed to get AI substitutions." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexPath = path.join(distPath, "index.html");
    
    // Log if dist or index.html is missing
    if (!fs.existsSync(distPath)) {
      console.error(`[PID: ${process.pid}] CRITICAL: dist directory missing at ${distPath}`);
    } else if (!fs.existsSync(indexPath)) {
      console.error(`[PID: ${process.pid}] CRITICAL: index.html missing at ${indexPath}`);
    } else {
      console.log(`[PID: ${process.pid}] Serving static files from ${distPath}`);
    }

    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(indexPath);
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Exiting to allow orchestrator to restart.`);
      process.exit(1);
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
