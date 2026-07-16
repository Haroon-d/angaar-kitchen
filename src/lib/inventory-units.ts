export type InventoryBaseUnit = "g" | "ml" | "piece";

export type InventoryUnitCode =
  | "mg"
  | "g"
  | "kg"
  | "oz"
  | "lb"
  | "ml"
  | "l"
  | "tsp"
  | "tbsp"
  | "cup"
  | "piece"
  | "pair"
  | "dozen"
  | "pack"
  | "box"
  | "bag"
  | "bottle"
  | "can"
  | "carton"
  | "crate"
  | "tray"
  | "sack"
  | "tin"
  | "jar"
  | "bunch";

type UnitDefinition = {
  code: InventoryUnitCode;
  label: string;
  baseUnit?: InventoryBaseUnit;
  factor?: number;
};

const STANDARD_UNITS: UnitDefinition[] = [
  { code: "mg", label: "Milligrams (mg)", baseUnit: "g", factor: 0.001 },
  { code: "g", label: "Grams (g)", baseUnit: "g", factor: 1 },
  { code: "kg", label: "Kilograms (kg)", baseUnit: "g", factor: 1000 },
  { code: "oz", label: "Ounces (oz)", baseUnit: "g", factor: 28.349523125 },
  { code: "lb", label: "Pounds (lb)", baseUnit: "g", factor: 453.59237 },
  { code: "ml", label: "Milliliters (ml)", baseUnit: "ml", factor: 1 },
  { code: "l", label: "Liters (L)", baseUnit: "ml", factor: 1000 },
  { code: "tsp", label: "Teaspoons (tsp)", baseUnit: "ml", factor: 4.92892159375 },
  { code: "tbsp", label: "Tablespoons (tbsp)", baseUnit: "ml", factor: 14.78676478125 },
  { code: "cup", label: "Cups", baseUnit: "ml", factor: 236.5882365 },
  { code: "piece", label: "Pieces", baseUnit: "piece", factor: 1 },
  { code: "pair", label: "Pairs", baseUnit: "piece", factor: 2 },
  { code: "dozen", label: "Dozens", baseUnit: "piece", factor: 12 },
];

const PACKAGING_UNITS: UnitDefinition[] = [
  { code: "pack", label: "Packs" },
  { code: "box", label: "Boxes" },
  { code: "bag", label: "Bags" },
  { code: "bottle", label: "Bottles" },
  { code: "can", label: "Cans" },
  { code: "carton", label: "Cartons" },
  { code: "crate", label: "Crates" },
  { code: "tray", label: "Trays" },
  { code: "sack", label: "Sacks" },
  { code: "tin", label: "Tins" },
  { code: "jar", label: "Jars" },
  { code: "bunch", label: "Bunches" },
];

const UNIT_BY_CODE = new Map(
  [...STANDARD_UNITS, ...PACKAGING_UNITS].map((unit) => [unit.code, unit]),
);

export function unitsForBase(baseUnit: InventoryBaseUnit, includePackaging = true) {
  const standard = STANDARD_UNITS.filter((unit) => unit.baseUnit === baseUnit);
  return includePackaging ? [...standard, ...PACKAGING_UNITS] : standard;
}

export function unitDefinition(code: string) {
  return UNIT_BY_CODE.get(code as InventoryUnitCode);
}

export function isPackagingUnit(code: string) {
  return !unitDefinition(code)?.baseUnit;
}

export function unitFactorToBase(
  baseUnit: InventoryBaseUnit,
  unitCode: string,
  customFactor?: number | string | null,
) {
  const unit = unitDefinition(unitCode);
  if (!unit) throw new Error(`Unsupported inventory unit: ${unitCode}`);
  if (unit.baseUnit) {
    if (unit.baseUnit !== baseUnit) {
      throw new Error(`${unit.label} cannot be used for stock measured in ${baseUnit}.`);
    }
    return unit.factor ?? 1;
  }
  const factor = Number(customFactor);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`Enter how many ${baseUnit} are contained in one ${unit.label.toLowerCase()}.`);
  }
  return factor;
}

export function quantityToBase(
  quantity: number,
  baseUnit: InventoryBaseUnit,
  unitCode: string,
  customFactor?: number | string | null,
) {
  if (!Number.isFinite(quantity)) throw new Error("Enter a valid quantity.");
  return quantity * unitFactorToBase(baseUnit, unitCode, customFactor);
}

export function quantityFromBase(
  quantity: number | string,
  baseUnit: InventoryBaseUnit,
  unitCode: string,
  customFactor?: number | string | null,
) {
  return Number(quantity || 0) / unitFactorToBase(baseUnit, unitCode, customFactor);
}

export function costToBase(
  costPerUnit: number,
  baseUnit: InventoryBaseUnit,
  unitCode: string,
  customFactor?: number | string | null,
) {
  return costPerUnit / unitFactorToBase(baseUnit, unitCode, customFactor);
}

export function costFromBase(
  costPerBaseUnit: number | string,
  baseUnit: InventoryBaseUnit,
  unitCode: string,
  customFactor?: number | string | null,
) {
  return Number(costPerBaseUnit || 0) * unitFactorToBase(baseUnit, unitCode, customFactor);
}

export function defaultOperationalUnit(baseUnit: InventoryBaseUnit): InventoryUnitCode {
  if (baseUnit === "g") return "kg";
  if (baseUnit === "ml") return "l";
  return "piece";
}

export function baseUnitLabel(baseUnit: InventoryBaseUnit) {
  return baseUnit === "piece" ? "pc" : baseUnit;
}

export function shortUnitLabel(unitCode: string) {
  if (unitCode === "l") return "L";
  return unitCode === "piece" ? "pc" : unitCode;
}
