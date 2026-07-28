// Shared with /print-rr3 (live MEWS-backed cards) and the BCP Reg Card
// (cached-snapshot-backed, so several tokens below are simply blank) - both
// render the same admin-editable ร.ร.๓ template (rr3_templates table /
// DEFAULT_RR3_TEMPLATE in api/app/routers/rr3.py) with the same tokens, so
// the printed form is identical either way.

export interface Rr3TokenData {
  HotelName?: string;
  FirstName?: string;
  LastName?: string;
  ReservationsNumber?: string;
  RoomNumber?: string;
  CheckIn?: string;
  CheckInTime?: string;
  CheckOut?: string;
  CheckOutTime?: string;
  PassportNumber?: string;
  IdentityCardNumber?: string;
  NationalityCode?: string;
  NationalityName?: string;
  AddressDetails?: string;
  Telephone?: string;
  Email?: string;
  Occupation?: string;
  AlienBook?: string;
  GuestSign?: string;
  Departure?: string;
  Destination?: string;
  // If set, rendered as an <img> in the <<GuestSign>> slot instead of the
  // plain-text GuestSign token above - a captured-on-screen signature
  // (see SignaturePad), not something MEWS itself ever provides.
  GuestSignatureDataUrl?: string;
}

export const escapeHtml = (s: string) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The template's dotted blank lines (e.g. "ชื่อตัว (Name) ....................")
// are laid out to fit one line by design - a value only overflows because
// it adds width the blank form never had. So rather than touch the
// surrounding label/dots at all, only the inserted value shrinks, and only
// as much as it needs to: measured with Canvas (approximates the print
// font closely enough to reliably avoid wrapping, even if not pixel-exact)
// against a conservative per-field width budget.
let measureCanvas: HTMLCanvasElement | null = null;
function fitFontSizePt(text: string, maxWidthPt: number, basePt: number, minPt: number): number {
  if (typeof document === "undefined" || !text) return basePt;
  measureCanvas = measureCanvas || document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return basePt;
  const PT_TO_PX = 4 / 3; // canvas font strings take px; 1pt = 4/3 px at 96dpi
  ctx.font = `${basePt * PT_TO_PX}px "Angsana New","TH Sarabun New",serif`;
  const widthPx = ctx.measureText(text).width;
  const maxWidthPx = maxWidthPt * PT_TO_PX;
  if (widthPx <= maxWidthPx || widthPx <= 0) return basePt;
  return Math.max(minPt, basePt * (maxWidthPx / widthPx));
}

// How much extra horizontal room (pt, at the base 14pt) each value
// realistically has before it starts crowding the rest of its line. Kept
// deliberately tight: measuring the live template showed every dotted line
// is already running close to the page-width edge on its own (e.g. the
// Occupation/Nationality line only just fit for a short "นักธุรกิจ" +
// "Singapore" - a longer pair would tip it the same way Name/Surname did),
// so budgets here bias toward shrinking a little early rather than risking
// a wrap. Tighter still for fields sharing a row with a second value
// (Name/Surname, Occupation/Nationality). Tune further if a specific field
// still overflows in practice.
const VALUE_WIDTH_BUDGET_PT: Record<string, number> = {
  FirstName: 65,
  LastName: 65,
  Occupation: 60,
  NationalityName: 60,
  AddressDetails: 180,
  Telephone: 70,
  PassportNumber: 95,
  AlienBook: 80,
  IdentityCardNumber: 140,
};

function fitValueHtml(key: string, value: string): string {
  const escaped = escapeHtml(value);
  const budget = VALUE_WIDTH_BUDGET_PT[key];
  if (!budget || !value) return escaped;
  const fitted = fitFontSizePt(value, budget, 14, 8);
  return fitted < 14 ? `<span style="font-size:${fitted.toFixed(1)}pt;">${escaped}</span>` : escaped;
}

// The 13-digit Thai ID card box layout: 1-4-5-2-1 digits separated by dashes.
export function buildIdBoxesHtml(identityCardNumber: string): string {
  const idDigits = (identityCardNumber || "").replace(/\D/g, "");
  const pattern = [1, 4, 5, 2, 1];
  let idx = 0;
  let html = "";
  pattern.forEach((count, p) => {
    for (let j = 0; j < count; j++) {
      html += `<span class="s4">${escapeHtml(idDigits[idx] || "")}</span>`;
      idx++;
    }
    if (p < pattern.length - 1) html += `<span class="dash">-</span>`;
  });
  return html;
}

export function renderRr3Template(template: string, d: Rr3TokenData): string {
  const tokens: Record<string, string> = {
    HotelName: d.HotelName || "",
    FirstName: d.FirstName || "",
    LastName: d.LastName || "",
    ReservationsNumber: d.ReservationsNumber || "",
    RoomNumber: d.RoomNumber || "",
    CheckIn: d.CheckIn || "",
    CheckInTime: d.CheckInTime || "",
    CheckOut: d.CheckOut || "",
    CheckOutTime: d.CheckOutTime || "",
    PassportNumber: d.PassportNumber || "",
    IdentityCardNumber: d.IdentityCardNumber || "",
    NationalityCode: d.NationalityCode || "",
    NationalityName: d.NationalityName || "",
    AddressDetails: d.AddressDetails || "",
    Telephone: d.Telephone || "",
    Email: d.Email || "",
    Occupation: d.Occupation || "",
    AlienBook: d.AlienBook || "",
    Departure: d.Departure || "",
    Destination: d.Destination || "",
  };
  let result = template;
  for (const [key, value] of Object.entries(tokens)) {
    result = result.split(`<<${key}>>`).join(fitValueHtml(key, value));
  }
  result = result.split("<<IdBoxes>>").join(buildIdBoxesHtml(d.IdentityCardNumber || ""));
  const guestSignHtml = d.GuestSignatureDataUrl
    ? `<img src="${d.GuestSignatureDataUrl}" style="height:26pt;max-width:110pt;vertical-align:bottom;" />`
    : escapeHtml(d.GuestSign || "");
  result = result.split("<<GuestSign>>").join(guestSignHtml);
  return result;
}
