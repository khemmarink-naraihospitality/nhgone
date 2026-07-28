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
    result = result.split(`<<${key}>>`).join(escapeHtml(value));
  }
  result = result.split("<<IdBoxes>>").join(buildIdBoxesHtml(d.IdentityCardNumber || ""));
  const guestSignHtml = d.GuestSignatureDataUrl
    ? `<img src="${d.GuestSignatureDataUrl}" style="height:26pt;max-width:110pt;vertical-align:bottom;" />`
    : escapeHtml(d.GuestSign || "");
  result = result.split("<<GuestSign>>").join(guestSignHtml);
  return result;
}
