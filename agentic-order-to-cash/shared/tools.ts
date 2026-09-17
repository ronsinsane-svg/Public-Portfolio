import catalog from "./data/catalog.json" with { type: "json" };
import contracts from "./data/contracts.json" with { type: "json" };
import inventory from "./data/inventory.json" with { type: "json" };
import invoices from "./data/invoices.json" with { type: "json" };
import meta from "./data/meta.json" with { type: "json" };
import orders from "./data/orders.json" with { type: "json" };
import remittances from "./data/remittances.json" with { type: "json" };

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  };
  strict?: boolean;
};

const stringProp = { type: "string" } as const;

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[],
): AnthropicToolDef["input_schema"] => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

export const TOOL_SCHEMAS: Record<string, AnthropicToolDef> = {
  list_catalog: {
    name: "list_catalog",
    description:
      "List the whole product catalog (sku, name, category, list price, case pack, status). Use this to resolve a product mentioned by name or category into its SKU, or to answer questions about items.",
    input_schema: objectSchema({}, []),
    strict: true,
  },
  list_retailers: {
    name: "list_retailers",
    description: "List all retailers with their IDs and names. Use this to resolve a retailer mentioned by name.",
    input_schema: objectSchema({}, []),
    strict: true,
  },
  lookup_sku: {
    name: "lookup_sku",
    description: "Look up a catalog SKU and return its product record if it exists.",
    input_schema: objectSchema({ sku: stringProp }, ["sku"]),
    strict: true,
  },
  get_price_list: {
    name: "get_price_list",
    description: "Return the contract price list for a retailer.",
    input_schema: objectSchema({ retailer_id: stringProp }, ["retailer_id"]),
    strict: true,
  },
  get_contract_terms: {
    name: "get_contract_terms",
    description: "Return retailer contract terms, clauses, and allowed deductions without the price list.",
    input_schema: objectSchema({ retailer_id: stringProp }, ["retailer_id"]),
    strict: true,
  },
  check_order_history: {
    name: "check_order_history",
    description: "Return up to ten fulfilled historical orders for a retailer.",
    input_schema: objectSchema({ retailer_id: stringProp }, ["retailer_id"]),
    strict: true,
  },
  check_inventory: {
    name: "check_inventory",
    description: "Return inventory for a SKU and the shipping metadata needed for feasibility checks.",
    input_schema: objectSchema({ sku: stringProp, date: stringProp }, ["sku", "date"]),
    strict: true,
  },
  get_ship_schedule: {
    name: "get_ship_schedule",
    description: "Return the configured shipping schedule and lead time.",
    input_schema: objectSchema({}, []),
    strict: true,
  },
  get_invoice: {
    name: "get_invoice",
    description: "Look up an invoice by invoice ID.",
    input_schema: objectSchema({ invoice_id: stringProp }, ["invoice_id"]),
    strict: true,
  },
  match_remittance_lines: {
    name: "match_remittance_lines",
    description: "Return a remittance with each remittance line joined to its invoice.",
    input_schema: objectSchema({ remittance_id: stringProp }, ["remittance_id"]),
    strict: true,
  },
};

// LLMs reliably miscount weekdays from bare ISO dates, so every date a tool
// returns carries its weekday computed here, deterministically.
export const withWeekday = (date: string): string =>
  `${date} (${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  })})`;

const annotatedMeta = () => ({
  ...meta,
  today: withWeekday(meta.today),
});

const requireString = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`Tool input field '${key}' must be a string.`);
  }
  return value;
};

const requireObjectInput = (input: unknown): Record<string, unknown> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }
  return input as Record<string, unknown>;
};

// Custom Scenario Builder runs inject their invented entity here; tools resolve
// overrides before the bundled dataset so an agent's normal tool calls find it.
// Agents are unchanged; they never know whether data is seeded or custom.
export type ToolOverrides = {
  orders?: any[];
  invoices?: any[];
  remittances?: any[];
};

export function runTool(name: string, input: any, overrides: ToolOverrides = {}): unknown {
  const args = requireObjectInput(input);
  const allInvoices: any[] = [...(overrides.invoices ?? []), ...invoices];
  const allRemittances: any[] = [...(overrides.remittances ?? []), ...remittances];
  const allOrders: any[] = [...(overrides.orders ?? []), ...orders];

  switch (name) {
    case "list_catalog":
      return catalog.map((c) => ({
        sku: c.sku,
        name: c.name,
        category: c.category,
        list_price: c.list_price,
        case_pack: c.case_pack,
        status: c.status,
        replacement_sku: c.replacement_sku,
      }));

    case "list_retailers":
      return contracts.map((c) => ({
        retailer_id: c.retailer_id,
        retailer_name: c.retailer_name,
      }));

    case "lookup_sku": {
      const sku = requireString(args, "sku");
      return catalog.find((item) => item.sku === sku) ?? { found: false, sku };
    }

    case "get_price_list": {
      const retailerId = requireString(args, "retailer_id");
      const contract = contracts.find((item) => item.retailer_id === retailerId);
      return contract
        ? { retailer_id: retailerId, price_list: contract.price_list }
        : { found: false };
    }

    case "get_contract_terms": {
      const retailerId = requireString(args, "retailer_id");
      const contract = contracts.find((item) => item.retailer_id === retailerId);
      if (!contract) {
        return { found: false, retailer_id: retailerId };
      }
      const { price_list: _priceList, ...terms } = contract;
      return terms;
    }

    case "check_order_history": {
      const retailerId = requireString(args, "retailer_id");
      return allOrders
        .filter((order) => order.retailer_id === retailerId && order.status === "fulfilled")
        .slice(0, 10);
    }

    case "check_inventory": {
      const sku = requireString(args, "sku");
      const date = requireString(args, "date");
      const record = inventory.find((item) => item.sku === sku);
      const shipMeta = { requested_date: withWeekday(date), ...annotatedMeta() };
      return record
        ? {
            ...record,
            inbound: record.inbound.map((r) => ({ ...r, date: withWeekday(r.date) })),
            ...shipMeta,
          }
        : { found: false, sku, ...shipMeta };
    }

    case "get_ship_schedule":
      return annotatedMeta();

    case "get_invoice": {
      const invoiceId = requireString(args, "invoice_id");
      return allInvoices.find((invoice) => invoice.invoice_id === invoiceId) ?? { found: false };
    }

    case "match_remittance_lines": {
      const remittanceId = requireString(args, "remittance_id");
      const remittance = allRemittances.find((item) => item.remittance_id === remittanceId);
      if (!remittance) {
        return { found: false, remittance_id: remittanceId };
      }
      return {
        remittance,
        lines: remittance.lines.map((line: { invoice_id: string }) => ({
          line,
          invoice: allInvoices.find((invoice) => invoice.invoice_id === line.invoice_id) ?? null,
        })),
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
