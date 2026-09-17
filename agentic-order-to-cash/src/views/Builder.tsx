import { useMemo, useState } from "react";
import { actions } from "../store.ts";
import { usd } from "../format.ts";
import catalog from "../../shared/data/catalog.json" with { type: "json" };
import contracts from "../../shared/data/contracts.json" with { type: "json" };
import invoices from "../../shared/data/invoices.json" with { type: "json" };
import meta from "../../shared/data/meta.json" with { type: "json" };

type Mode = "order" | "remittance";
type Line = { sku: string; qty: string; unitPrice: string };

const activeSkus = catalog.filter((c) => c.status === "active");

function contractPrice(retailerId: string, sku: string): number | null {
  const c = contracts.find((x) => x.retailer_id === retailerId);
  const p = c?.price_list.find((l) => l.sku === sku);
  return p ? p.contract_price : null;
}

export default function Builder({ onRun }: { onRun: () => void }) {
  const [mode, setMode] = useState<Mode>("remittance");

  return (
    <div className="builder">
      <p className="guard-note" style={{ maxWidth: "76ch" }}>
        Compose a synthetic case from the real catalog and contracts, then run it live through the
        same agents. Custom runs have no recording, so they always execute against the API (not
        replay); the result streams into the pipeline like any other run.
      </p>

      <div className="seg" style={{ margin: "4px 0 20px" }}>
        <button aria-pressed={mode === "order"} onClick={() => setMode("order")}>
          Custom order
        </button>
        <button aria-pressed={mode === "remittance"} onClick={() => setMode("remittance")}>
          Custom remittance
        </button>
      </div>

      {mode === "order" ? <OrderForm onRun={onRun} /> : <RemittanceForm onRun={onRun} />}
    </div>
  );
}

function OrderForm({ onRun }: { onRun: () => void }) {
  const [retailerId, setRetailerId] = useState(contracts[0].retailer_id);
  const [lines, setLines] = useState<Line[]>([
    { sku: activeSkus[0].sku, qty: "240", unitPrice: "" },
  ]);
  const [shipDate, setShipDate] = useState(plusDays(meta.today, 6));
  const [mismatch, setMismatch] = useState(false);
  const [badDate, setBadDate] = useState(false);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // Toggle helpers prefill fields; submit always reads the field values.
  const toggleMismatch = (on: boolean) => {
    setMismatch(on);
    if (on && lines[0]) {
      const cp = contractPrice(retailerId, lines[0].sku);
      if (cp != null) setLine(0, { unitPrice: (Math.round(cp * 108) / 100).toFixed(2) });
    }
  };
  const toggleBadDate = (on: boolean) => {
    setBadDate(on);
    if (on) setShipDate(meta.today); // same-day cannot meet the 3-day lead time
  };

  const run = () => {
    const id = actions.nextCustomId("ORD");
    const entity = {
      id,
      type: "edi",
      retailer_id: retailerId,
      po_number: null,
      requested_ship_date: shipDate,
      lines: lines.map((l) => ({
        sku: l.sku,
        qty: Number(l.qty) || 0,
        unit_price: Number(l.unitPrice) || 0,
      })),
      custom: true,
      builderLabel: "Custom order",
    };
    actions.runCustom(entity, "orders", {});
    onRun();
  };

  const valid = lines.every((l) => l.sku && Number(l.qty) > 0 && Number(l.unitPrice) > 0);

  return (
    <div className="builder-card">
      <Field label="Retailer">
        <select value={retailerId} onChange={(e) => setRetailerId(e.target.value)}>
          {contracts.map((c) => (
            <option key={c.retailer_id} value={c.retailer_id}>
              {c.retailer_name}
            </option>
          ))}
        </select>
      </Field>

      <div className="field-label">Lines</div>
      {lines.map((l, i) => {
        const cp = contractPrice(retailerId, l.sku);
        return (
          <div className="line-row" key={i}>
            <select value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })}>
              {activeSkus.map((s) => (
                <option key={s.sku} value={s.sku}>
                  {s.sku} — {s.name}
                </option>
              ))}
            </select>
            <input
              className="num"
              type="number"
              min="1"
              value={l.qty}
              onChange={(e) => setLine(i, { qty: e.target.value })}
              placeholder="qty"
            />
            <input
              className="num"
              type="number"
              step="0.01"
              value={l.unitPrice}
              onChange={(e) => setLine(i, { unitPrice: e.target.value })}
              placeholder="unit $"
            />
            <span className="hint mono">
              {cp != null ? `contract ${usd(cp)}` : "not on price list"}
            </span>
            {lines.length > 1 && (
              <button
                className="line-x"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                aria-label="remove line"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        className="btn ghost"
        onClick={() =>
          setLines((ls) => [...ls, { sku: activeSkus[0].sku, qty: "120", unitPrice: "" }])
        }
      >
        + Add line
      </button>

      <Field label="Requested ship date">
        <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
      </Field>

      <div className="toggles">
        <Toggle checked={mismatch} onChange={toggleMismatch}>
          Introduce a price mismatch <span className="hint">(sets line 1 above contract)</span>
        </Toggle>
        <Toggle checked={badDate} onChange={toggleBadDate}>
          Request an impossible ship date <span className="hint">(same-day, under lead time)</span>
        </Toggle>
      </div>

      <RunButton onClick={run} disabled={!valid} />
    </div>
  );
}

const allowedPct = (rid: string) =>
  contracts.find((c) => c.retailer_id === rid)?.allowed_deduction_pct ?? 0;

function RemittanceForm({ onRun }: { onRun: () => void }) {
  const initialRetailer = invoices[0]?.retailer_id ?? contracts[0].retailer_id;
  const [retailerId, setRetailerId] = useState(initialRetailer);
  const retailerInvoices = useMemo(
    () => invoices.filter((iv) => iv.retailer_id === retailerId),
    [retailerId],
  );
  const [invoiceId, setInvoiceId] = useState(retailerInvoices[0]?.invoice_id ?? "");
  const [pct, setPct] = useState(String(allowedPct(initialRetailer) + 5));
  const [overDeduct, setOverDeduct] = useState(true);

  const allowed = allowedPct(retailerId);
  const invoice = invoices.find((iv) => iv.invoice_id === invoiceId) ?? retailerInvoices[0];

  const onRetailer = (rid: string) => {
    setRetailerId(rid);
    const first = invoices.find((iv) => iv.retailer_id === rid);
    setInvoiceId(first?.invoice_id ?? "");
    if (overDeduct) setPct(String(allowedPct(rid) + 5));
  };
  const toggleOver = (on: boolean) => {
    setOverDeduct(on);
    if (on) setPct(String(allowed + 5));
  };

  const pctNum = Number(pct) || 0;
  const amount = invoice?.total ?? 0;
  const deduction = Math.round(amount * pctNum) / 100;
  const paid = Math.round((amount - deduction) * 100) / 100;

  const run = () => {
    if (!invoice) return;
    const id = actions.nextCustomId("REM");
    const entity = {
      id,
      remittance_id: id,
      retailer_id: retailerId,
      // Pay inside the 10-day early-payment window so the discount is valid and
      // the only issue is the deduction percentage, not the timing.
      payment_date: plusDays(invoice.issued, 5),
      amount_paid: paid,
      lines: [
        {
          invoice_id: invoice.invoice_id,
          invoice_amount: amount,
          paid,
          deductions: [{ code: "EARLY-PAY", amount: deduction }],
        },
      ],
      custom: true,
      builderLabel: `Custom · ${pctNum}% deduction`,
    };
    // Inject so the deduction agent's match_remittance_lines resolves it.
    actions.runCustom(entity, "payments", { remittances: [entity] });
    onRun();
  };

  const over = pctNum > allowed;

  return (
    <div className="builder-card">
      <Field label="Retailer">
        <select value={retailerId} onChange={(e) => onRetailer(e.target.value)}>
          {contracts.map((c) => (
            <option key={c.retailer_id} value={c.retailer_id}>
              {c.retailer_name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Invoice">
        <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          {retailerInvoices.map((iv) => (
            <option key={iv.invoice_id} value={iv.invoice_id}>
              {iv.invoice_id} — {usd(iv.total)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Early-payment deduction">
        <div className="pct-row">
          <input
            className="num"
            type="number"
            step="0.5"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
          <span className="pct-sign">%</span>
          <span className="hint mono">contract allows {allowed}%</span>
        </div>
      </Field>

      <div className="toggles">
        <Toggle checked={overDeduct} onChange={toggleOver}>
          Over-deduct <span className="hint">(preset {allowed + 5}%, above the {allowed}% cap)</span>
        </Toggle>
      </div>

      <div className={`preview-figures${over ? " over" : ""}`}>
        <div>
          <span className="pf-label">Invoice</span>
          <span className="num">{usd(amount)}</span>
        </div>
        <div>
          <span className="pf-label">Deducted</span>
          <span className="num">{usd(deduction)}</span>
        </div>
        <div>
          <span className="pf-label">Paid</span>
          <span className="num">{usd(paid)}</span>
        </div>
        <div>
          <span className="pf-label">Variance vs. cap</span>
          <span className="num">
            {over ? usd(Math.round(amount * (pctNum - allowed)) / 100) : usd(0)}
          </span>
        </div>
      </div>

      <RunButton onClick={run} disabled={!invoice || pctNum <= 0} />
    </div>
  );
}

// --- small form primitives --------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className={`toggle${checked ? " on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="knob" /></span>
      <span>{children}</span>
    </label>
  );
}

function RunButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button className="btn btn-primary run-btn" onClick={onClick} disabled={disabled}>
      Run live through agents →
    </button>
  );
}

function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
