// Display helpers. Money as fixed 2dp with thousands separators, tabular.
export const usd = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const SCENARIO_LABEL: Record<number, string> = {
  1: "Clean EDI order",
  2: "Email / customer order form",
  3: "Pricing discrepancy",
  4: "Discontinued item (R1→R2)",
  5: "Infeasible ship date",
  6: "Clean settlement",
  7: "Over-deduction",
};

export function scenarioOf(entity: unknown): number | undefined {
  return (entity as { scenario?: number }).scenario;
}

export function runLabel(entity: unknown): string {
  const e = entity as { scenario?: number; custom?: boolean; builderLabel?: string };
  if (e.custom) return e.builderLabel ?? "Custom scenario";
  return e.scenario ? SCENARIO_LABEL[e.scenario] : "historical";
}
