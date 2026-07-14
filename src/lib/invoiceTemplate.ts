export interface LineItem {
  no: number | "";
  description: string;
  amount: number | "";
}

export interface Invoice {
  mews_id: string;
  number: string;
  type: string;
  state: string;
  issued_at: string;
  due_at: string;
  owner_name: string;
  address_lines: string[];
  post_code: string;
  tax_id: string;
  line_items: LineItem[];
  sub_total: number;
  vat_rate_pct: number;
  vat: number;
  provincial_tax_rate_pct: number;
  provincial_tax: number;
  net_amount: number;
  baht_text: string;
  payment_method: { cash: boolean; card: boolean; bank_transfer: boolean; cheque: boolean };
  bank_transfer_ref: string;
  bank_transfer_date: string;
  cheque: { bank_name: string; branch: string; number: string; date: string };
}

export const fmtAmount = (v: number | "") =>
  v === "" ? "" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const escapeHtml = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Substitutes <<Token>> placeholders in an admin-edited HTML template with
// this bill's real data. Company name/address/tax id are NOT tokens - they're
// static text the admin types directly into their property's own template.
// Shared between the on-screen preview (print-bill/[id]) and the server-side
// PDF export route so both always render identically.
export function renderInvoiceTemplate(template: string, inv: Invoice): string {
  const box = (checked: boolean) => (checked ? "☑" : "☐");
  const addr = inv.address_lines || [];
  const tokens: Record<string, string> = {
    InvoiceNoF: inv.number || "",
    DateF: fmtDate(inv.issued_at),
    OwnerName: inv.owner_name || "",
    AddressLine1: addr[0] || "",
    AddressLine2: addr[1] || "",
    AddressLine3: addr[2] || "",
    AddressLine4: addr[3] || "",
    AddressLine5: addr[4] || "",
    PostCode: inv.post_code || "",
    TAXID: inv.tax_id || "",
    BahtTextE: inv.baht_text || "",
    SubTotal: fmtAmount(inv.sub_total),
    VATC: `${inv.vat_rate_pct}%`,
    VAT: fmtAmount(inv.vat),
    PTC: `${inv.provincial_tax_rate_pct ?? 1}%`,
    PT: fmtAmount(inv.provincial_tax ?? 0),
    NetAmount: fmtAmount(inv.net_amount),
    CH: box(inv.payment_method.cash),
    CD: box(inv.payment_method.card),
    BT: box(inv.payment_method.bank_transfer),
    CK: box(inv.payment_method.cheque),
    BankTransferDateF: fmtDate(inv.bank_transfer_date),
    BankTransferRef: inv.bank_transfer_ref || "",
    BankName: inv.cheque.bank_name || "",
    Branch: inv.cheque.branch || "",
    CNo: inv.cheque.number || "",
    CDateF: fmtDate(inv.cheque.date),
  };
  for (let i = 0; i < 5; i++) {
    const li = inv.line_items[i];
    tokens[`No${i + 1}`] = li && li.no !== "" ? String(li.no) : "";
    tokens[`Description${i + 1}`] = li ? li.description : "";
    tokens[`AmountP${i + 1}`] = li && li.amount !== "" ? fmtAmount(li.amount) : "";
  }

  let result = template;
  for (const [key, value] of Object.entries(tokens)) {
    result = result.split(`<<${key}>>`).join(escapeHtml(value));
  }
  return result;
}

// The @page / page-break CSS that keeps each invoice's Original/Copy card on
// its own clean A4 page, shared by the on-screen preview and the PDF export
// route so print-to-PDF (browser) and server-rendered PDF stay visually
// identical.
export const INVOICE_PRINT_CSS = `
  @page {
    size: A4;
    margin: 10mm;
  }
  @media print {
    .invoice-page {
      page-break-after: always;
      break-after: page;
    }
    .invoice-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .invoice-page > div {
      page-break-inside: avoid;
      break-inside: avoid;
    }
  }
`;
