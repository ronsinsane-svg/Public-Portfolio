import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "shared", "data");

const fileNames = {
  meta: "meta.json",
  catalog: "catalog.json",
  contracts: "contracts.json",
  inventory: "inventory.json",
  orders: "orders.json",
  invoices: "invoices.json",
  remittances: "remittances.json"
};

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const loadJson = async (fileName) => {
  try {
    return JSON.parse(await readFile(path.join(dataDir, fileName), "utf8"));
  } catch (error) {
    fail(`${fileName} did not parse: ${error.message}`);
  }
};

const cents = (value, label) => {
  assert(typeof value === "number" && Number.isFinite(value), `${label} must be a number`);
  const rounded = Math.round(value * 100);
  assert(Math.abs(value * 100 - rounded) < 0.000001, `${label} has more than 2 decimal places`);
  return rounded;
};

const moneyEq = (left, right) => cents(left, "money value") === cents(right, "money value");

const byKey = (items, key) => new Map(items.map((item) => [item[key], item]));

const run = async () => {
  const data = {};
  for (const [key, fileName] of Object.entries(fileNames)) {
    data[key] = await loadJson(fileName);
  }

  const { catalog, contracts, inventory, orders, invoices, remittances } = data;

  assert(Array.isArray(catalog), "catalog must be an array");
  assert(catalog.length === 20, "catalog must contain exactly 20 SKUs");

  const catalogBySku = byKey(catalog, "sku");
  assert(catalogBySku.size === catalog.length, "catalog SKUs must be unique");

  for (const category of ["cleaning", "kitchen", "laundry", "storage"]) {
    const count = catalog.filter((item) => item.category === category).length;
    assert(count === 5, `catalog category ${category} must have 5 SKUs`);
  }

  const discontinued = catalog.filter((item) => item.status === "discontinued");
  assert(discontinued.length === 1, "catalog must have exactly one discontinued SKU");
  const replacement = catalogBySku.get(discontinued[0].replacement_sku);
  assert(replacement?.status === "active", "discontinued SKU replacement_sku must exist and be active");

  // Scenario 2's email names "that new bamboo shelf liner" with no SKU. Exactly one
  // catalog match keeps that resolution unambiguous, so a wrong pick is a real miss
  // rather than a coin flip between two plausible SKUs.
  const bambooStorage = catalog.filter((item) => item.category === "storage" && /bamboo/i.test(item.name));
  assert(bambooStorage.length === 1, "catalog must have exactly one storage SKU with Bamboo in the name");

  const activeSkus = new Set(catalog.filter((item) => item.status === "active").map((item) => item.sku));
  const contractByRetailer = byKey(contracts, "retailer_id");

  const assertSku = (sku, context) => assert(catalogBySku.has(sku), `${context} references unknown SKU ${sku}`);
  const assertRetailer = (retailerId, context) => {
    if (retailerId !== null) assert(contractByRetailer.has(retailerId), `${context} references unknown retailer ${retailerId}`);
  };

  for (const contract of contracts) {
    assertRetailer(contract.retailer_id, `contract ${contract.retailer_id}`);
    for (const price of contract.price_list) assertSku(price.sku, `contract ${contract.retailer_id}`);
  }

  for (const item of inventory) assertSku(item.sku, "inventory");
  for (const order of orders) {
    assertRetailer(order.retailer_id, `order ${order.id}`);
    for (const line of order.lines ?? []) assertSku(line.sku, `order ${order.id}`);
  }
  for (const invoice of invoices) {
    assertRetailer(invoice.retailer_id, `invoice ${invoice.invoice_id}`);
    for (const line of invoice.lines) assertSku(line.sku, `invoice ${invoice.invoice_id}`);
  }
  for (const remittance of remittances) {
    assertRetailer(remittance.retailer_id, `remittance ${remittance.remittance_id}`);
  }

  const inventorySkus = new Set(inventory.map((item) => item.sku));
  for (const sku of activeSkus) assert(inventorySkus.has(sku), `inventory missing active SKU ${sku}`);

  const contractPrice = (retailerId, sku) => {
    const contract = contractByRetailer.get(retailerId);
    const price = contract?.price_list.find((entry) => entry.sku === sku)?.contract_price;
    assert(typeof price === "number", `missing contract price for ${retailerId} ${sku}`);
    return price;
  };

  const casePack = (sku) => catalogBySku.get(sku).case_pack;
  const orderById = byKey(orders, "id");

  const scenario1 = orders.find((order) => order.scenario === 1);
  assert(scenario1?.retailer_id === "RET-SUMMIT", "scenario 1 order must be Summit");
  for (const line of scenario1.lines) {
    assert(moneyEq(line.unit_price, contractPrice("RET-SUMMIT", line.sku)), `scenario 1 price mismatch for ${line.sku}`);
    assert(line.qty % casePack(line.sku) === 0, `scenario 1 qty for ${line.sku} is not a case-pack multiple`);
  }

  const scenario3 = orders.find((order) => order.scenario === 3);
  assert(scenario3?.retailer_id === "RET-CEDAR", "scenario 3 order must be Cedar");
  const deviations = scenario3.lines.filter((line) => !moneyEq(line.unit_price, contractPrice("RET-CEDAR", line.sku)));
  assert(deviations.length === 1, "scenario 3 must have exactly one contract price deviation");

  // Scenario 4 exercises the discontinued-item path, so it must order whichever SKU
  // the catalog marks discontinued. Derived rather than hardcoded: the assertion then
  // follows the catalog instead of silently going stale when the dataset changes.
  const scenario4 = orders.find((order) => order.scenario === 4);
  const discontinuedSku = discontinued[0].sku;
  assert(
    scenario4?.lines.some((line) => line.sku === discontinuedSku),
    `scenario 4 must contain the discontinued SKU ${discontinuedSku}`
  );

  const scenario5 = orders.find((order) => order.scenario === 5);
  assert(scenario5?.lines.length === 1, "scenario 5 must have one line");
  const constrainedLine = scenario5.lines[0];
  const constrainedInventory = inventory.find((item) => item.sku === constrainedLine.sku);
  assert(constrainedLine.qty === 720, "scenario 5 must request qty 720");
  assert(constrainedInventory?.on_hand === 200, "scenario 5 constrained SKU must have 200 on hand");
  assert(
    constrainedInventory.inbound.some((entry) => entry.date === "2026-07-16" && entry.qty === 1200),
    "scenario 5 constrained SKU must have 1200 inbound on 2026-07-16"
  );

  // Scenario 2 asks for "our usual snack bags". That phrase is only resolvable if the
  // retailer's history actually establishes a usual, so require a repeat purchase.
  const harborHistorical = orders.filter((order) => order.status === "fulfilled" && order.retailer_id === "RET-HARBOR");
  const kitchenCounts = new Map();
  for (const order of harborHistorical) {
    const kitchenSkus = new Set(order.lines.filter((line) => catalogBySku.get(line.sku).category === "kitchen").map((line) => line.sku));
    for (const sku of kitchenSkus) kitchenCounts.set(sku, (kitchenCounts.get(sku) ?? 0) + 1);
  }
  assert([...kitchenCounts.values()].some((count) => count >= 3), "Harbor historical orders must share one common kitchen SKU at least 3 times");

  const invoiceById = byKey(invoices, "invoice_id");
  for (const invoice of invoices) {
    assert(orderById.has(invoice.order_id), `invoice ${invoice.invoice_id} references missing order ${invoice.order_id}`);
    let total = 0;
    for (const line of invoice.lines) {
      const expected = line.qty * cents(line.unit_price, `${invoice.invoice_id} ${line.sku} unit_price`);
      const amount = cents(line.amount, `${invoice.invoice_id} ${line.sku} amount`);
      assert(amount === expected, `invoice ${invoice.invoice_id} line ${line.sku} amount mismatch`);
      total += amount;
    }
    assert(total === cents(invoice.total, `${invoice.invoice_id} total`), `invoice ${invoice.invoice_id} total mismatch`);
  }

  const remittanceById = byKey(remittances, "remittance_id");
  const rem3001 = remittanceById.get("REM-3001");
  const rem3001Line = rem3001?.lines[0];
  const rem3001Invoice = invoiceById.get("INV-2107");
  assert(rem3001 && rem3001Line && rem3001Invoice, "REM-3001 or INV-2107 missing");
  const inv2107 = cents(126900, "INV-2107 expected total");
  const rem3001Deduction = cents(rem3001Line.deductions[0].amount, "REM-3001 deduction");
  assert(cents(rem3001Invoice.total, "INV-2107 total") === inv2107, "INV-2107 must total 126900.00");
  assert(rem3001Deduction === Math.round(inv2107 * 17 / 100), "REM-3001 deduction must be 17% of 126900.00");
  assert(cents(rem3001Line.paid, "REM-3001 paid") + rem3001Deduction === cents(rem3001Line.invoice_amount, "REM-3001 invoice_amount"), "REM-3001 paid plus deduction must equal invoice amount");
  const summitAllowed = Math.round(inv2107 * contractByRetailer.get("RET-SUMMIT").allowed_deduction_pct / 100);
  assert(summitAllowed === cents(19035, "Summit allowed deduction"), "Summit allowed deduction must be 19035.00");
  assert(rem3001Deduction - summitAllowed === cents(2538, "Summit variance"), "REM-3001 variance must be 2538.00");

  const rem3002 = remittanceById.get("REM-3002");
  const rem3002Line = rem3002?.lines[0];
  const rem3002Invoice = invoiceById.get("INV-2044");
  assert(rem3002 && rem3002Line && rem3002Invoice, "REM-3002 or INV-2044 missing");
  const inv2044 = cents(18450, "INV-2044 expected total");
  const rem3002Deduction = cents(rem3002Line.deductions[0].amount, "REM-3002 deduction");
  assert(cents(rem3002Invoice.total, "INV-2044 total") === inv2044, "INV-2044 must total 18450.00");
  assert(rem3002Deduction === Math.round(inv2044 * 10 / 100), "REM-3002 deduction must be 10% of 18450.00");
  assert(cents(rem3002Line.paid, "REM-3002 paid") + rem3002Deduction === cents(rem3002Line.invoice_amount, "REM-3002 invoice_amount"), "REM-3002 paid plus deduction must equal invoice amount");

  console.log(`PASS catalog=${catalog.length} retailers=${contracts.length} orders=${orders.length} invoices=${invoices.length} remittances=${remittances.length}`);
};

run();
