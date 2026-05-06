import { Recipe, CalculationResult, IngredientCost } from '../types';

const DEFAULT_DENSITY_VG = 1.26;
const DEFAULT_DENSITY_PG = 1.038;

export function calculateRecipe(
  recipe: Recipe, 
  costs: IngredientCost, 
  densities?: { pg?: number, vg?: number }
): CalculationResult {
  const { servingMl, targetNicMg, targetPgRatio, nicBaseMg, nicBaseType, nicBasePgRatio, flavors } = recipe;
  
  const pgDensity = densities?.pg || DEFAULT_DENSITY_PG;
  const vgDensity = densities?.vg || DEFAULT_DENSITY_VG;

  // Determine nicotine base PG/VG ratio (normalize to 0-100)
  const nicPgRatio = nicBasePgRatio !== undefined ? nicBasePgRatio : (nicBaseType === 'PG' ? 100 : 0);
  const nicVgRatio = 100 - nicPgRatio;

  // 1. Nicotine calculation
  const nicotineMl = nicBaseMg > 0 ? (targetNicMg * servingMl) / nicBaseMg : 0;
  
  // Calculate nicotine base specific gravity
  const nicotineBaseDensity = (nicPgRatio / 100 * pgDensity) + (nicVgRatio / 100 * vgDensity);
  const nicotineGrams = nicotineMl * nicotineBaseDensity;

  // 2. Flavour calculations (assuming flavours are PG-based)
  const flavorResults = flavors.map(f => {
    const ml = (f.percentage / 100) * servingMl;
    return {
      id: f.id,
      name: f.name,
      ml,
      grams: ml * pgDensity, // Assuming flavours are PG-based
      percentage: f.percentage
    };
  });

  const totalFlavorMl = flavorResults.reduce((acc, f) => acc + f.ml, 0);

  // 3. PG/VG Target volumes
  const targetPgMl = (targetPgRatio / 100) * servingMl;
  const targetVgMl = servingMl - targetPgMl;

  // 4. Actual PG/VG to add
  let actualPgMl = targetPgMl;
  let actualVgMl = targetVgMl;

  // Subtract flavours from PG (assuming flavours are PG-based)
  actualPgMl -= totalFlavorMl;

  // Subtract nicotine portions based on its PG/VG ratio
  const nicotinePgContribution = nicotineMl * (nicPgRatio / 100);
  const nicotineVgContribution = nicotineMl * (nicVgRatio / 100);
  
  actualPgMl -= nicotinePgContribution;
  actualVgMl -= nicotineVgContribution;

  // Ensure no negative values
  actualPgMl = Math.max(0, actualPgMl);
  actualVgMl = Math.max(0, actualVgMl);

  const pgGrams = actualPgMl * pgDensity;
  const vgGrams = actualVgMl * vgDensity;

  // 5. Costs
  const nicCost = nicotineMl * costs.nicCostPerMl;
  const pgCost = actualPgMl * costs.pgCostPerMl;
  const vgCost = actualVgMl * costs.vgCostPerMl;
  const flavorsCost = flavorResults.reduce((acc, f) => {
    const flavor = flavors.find(fl => fl.id === f.id);
    return acc + (f.ml * (flavor?.costPerMl || 0.43)); // Default cost if not provided
  }, 0);

  const totalCost = nicCost + pgCost + vgCost + flavorsCost + costs.bottleCost;

  return {
    nicotineMl,
    nicotineGrams,
    pgMl: actualPgMl,
    pgGrams,
    vgMl: actualVgMl,
    vgGrams,
    flavorResults,
    totalMl: servingMl,
    totalGrams: nicotineGrams + pgGrams + vgGrams + flavorResults.reduce((acc, f) => acc + f.grams, 0),
    totalCost
  };
}
