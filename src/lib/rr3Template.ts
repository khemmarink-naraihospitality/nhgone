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
  // Filled in on the Reg Card screen before the guest signs (front desk
  // input, not MEWS data) - "X" marks the ticked checkbox, the *Detail
  // fields are the free-text ruled line under each section. Section 1/2 are
  // each a two-way choice (current address vs. another one), so exactly one
  // of the pair's Chk tokens is ever "X" at a time.
  DepartureCurrentChk?: string;
  DepartureOtherChk?: string;
  DepartureDetail?: string;
  DestinationCurrentChk?: string;
  DestinationOtherChk?: string;
  DestinationDetail?: string;
  // If set, rendered as an <img> in the <<GuestSign>> slot instead of the
  // plain-text GuestSign token above - a captured-on-screen signature
  // (see SignaturePad), not something MEWS itself ever provides.
  GuestSignatureDataUrl?: string;
}

export const escapeHtml = (s: string) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// First attempt at this (fitting just the inserted value against a guessed
// per-field width budget) still wrapped in practice: the dots/label text
// alone were already eating most of the page width before any data was
// even inserted, so shrinking only the value didn't help. This measures
// each *whole rendered line* (labels, dots, and value together) against
// the page's actual usable width and shrinks that line's own font-size
// just enough to keep it on one line - correct regardless of how long the
// label/dot-fill is, so it isn't a guess anymore.
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

// .center-table is 210mm wide with 15mm left/right padding (see the
// template's own <style>) - 180mm of usable width, in pt (1mm = 2.83465pt),
// with a small safety margin since Canvas metrics only approximate the
// actual print font.
const PAGE_CONTENT_WIDTH_PT = 180 * 2.83465 * 0.96;

function stripTagsToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

// Runs last, after every <<Token>> has already been substituted in, so it
// sees exactly what will print. Only touches plain body-text paragraphs
// (class="s1"/"s2") that don't already carry a hand-tuned font-size (e.g.
// the Room No. line), so it can't fight with a more specific existing style.
//
// Shrinking each line to its own individually-needed size (the first
// version of this) technically stopped every line wrapping, but left the
// form looking like a patchwork of different type sizes depending on how
// long that particular line's data happened to be. Instead: find whichever
// s1 line needs the *most* shrinking, then apply that one size to every s1
// line uniformly (same for s2, kept as its own tier since it's the larger
// heading style) - the whole form still reads as one consistent size, and
// every line has strictly *more* margin than the one that set the size, so
// none of them wrap either.
const PARAGRAPH_RE = /<p((?:\s+[^>]*)?)>([\s\S]*?)<\/p>/g;

// A paragraph marked class="half" (e.g. the Name/Surname row, split into two
// 50%-wide <td> columns so Surname always starts at the line's midpoint
// regardless of how long the first name is) only has half the page's usable
// width to render in - it must fit against that narrower budget, not the
// full-page one every other s1/s2 line uses.
function eligibleParagraphFontSize(attrs: string): { tier: "s1" | "s2"; basePt: number; maxWidthPt: number } | null {
  if (/font-size\s*:/.test(attrs)) return null;
  const maxWidthPt = /class="[^"]*\bhalf\b[^"]*"/.test(attrs) ? PAGE_CONTENT_WIDTH_PT / 2 : PAGE_CONTENT_WIDTH_PT;
  if (/class="[^"]*\bs2\b[^"]*"/.test(attrs)) return { tier: "s2", basePt: 15, maxWidthPt };
  if (/class="[^"]*\bs1\b[^"]*"/.test(attrs)) return { tier: "s1", basePt: 14, maxWidthPt };
  return null;
}

function fitParagraphsToOneLine(html: string): string {
  if (typeof document === "undefined") return html;

  let minS1 = 14;
  let minS2 = 15;
  for (const match of html.matchAll(PARAGRAPH_RE)) {
    const [, attrs, inner] = match;
    const eligible = eligibleParagraphFontSize(attrs);
    if (!eligible) continue;
    const text = stripTagsToText(inner);
    if (!text) continue;
    const fitted = fitFontSizePt(text, eligible.maxWidthPt, eligible.basePt, 9);
    if (eligible.tier === "s2") minS2 = Math.min(minS2, fitted);
    else minS1 = Math.min(minS1, fitted);
  }
  if (minS1 >= 14 && minS2 >= 15) return html; // every line already fits at its normal size

  return html.replace(PARAGRAPH_RE, (match, attrs: string, inner: string) => {
    const eligible = eligibleParagraphFontSize(attrs);
    if (!eligible) return match;
    const size = eligible.tier === "s2" ? minS2 : minS1;
    if (size >= eligible.basePt) return match;
    const addition = `font-size:${size.toFixed(1)}pt;white-space:nowrap;`;
    const newAttrs = /style="/.test(attrs)
      ? attrs.replace(/style="([^"]*)"/, (_m: string, existing: string) => `style="${existing}${existing.endsWith(";") ? "" : ";"}${addition}"`)
      : `${attrs} style="${addition}"`;
    return `<p${newAttrs}>${inner}</p>`;
  });
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
    DepartureCurrentChk: d.DepartureCurrentChk || "",
    DepartureOtherChk: d.DepartureOtherChk || "",
    DepartureDetail: d.DepartureDetail || "",
    DestinationCurrentChk: d.DestinationCurrentChk || "",
    DestinationOtherChk: d.DestinationOtherChk || "",
    DestinationDetail: d.DestinationDetail || "",
  };
  let result = template;
  for (const [key, value] of Object.entries(tokens)) {
    result = result.split(`<<${key}>>`).join(escapeHtml(value));
  }
  result = result.split("<<IdBoxes>>").join(buildIdBoxesHtml(d.IdentityCardNumber || ""));
  const guestSignHtml = d.GuestSignatureDataUrl
    ? `<img src="${d.GuestSignatureDataUrl}" style="height:26pt;max-width:110pt;vertical-align:bottom;" />`
    : escapeHtml(d.GuestSign || "");
  result = result.split("<<GuestSign>>").join(guestSignHtml);
  return fitParagraphsToOneLine(result);
}
