"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/PageHeader";

type TemplateType =
  | "billing"
  | "rr3"
  | "email"
  | "internal_welcome_email"
  | "password_reset_email"
  | "google_signin_notice_email"
  | "rejection_email"
  | "st_files_email"
  | "st_files_email_per_property";

interface TokenDoc {
  name: string;
  description: string;
}

const BILLING_TOKENS: TokenDoc[] = [
  { name: "InvoiceNoF", description: "Bill/invoice number" },
  { name: "DateF", description: "Issued date (DD/MM/YYYY)" },
  { name: "OwnerName", description: "Guest or company name" },
  { name: "AddressLine1", description: "Address line 1 (through AddressLine5)" },
  { name: "PostCode", description: "Postal code" },
  { name: "TAXID", description: "Guest/company Tax ID (not the property's own)" },
  { name: "No1", description: "Line item row number (through No5)" },
  { name: "Description1", description: "Line item description (through Description5)" },
  { name: "AmountP1", description: "Line item amount (through AmountP5)" },
  { name: "BahtTextE", description: "Total spelled out in Thai" },
  { name: "SubTotal", description: "Net amount before taxes" },
  { name: "VATC", description: "VAT rate (always 7%)" },
  { name: "VAT", description: "VAT amount (7% only, provincial tax excluded)" },
  { name: "PTC", description: "Provincial tax rate, e.g. 1%" },
  { name: "PT", description: "Provincial tax amount (separated from VAT, like the MEWS bill)" },
  { name: "NetAmount", description: "Total amount" },
  { name: "CH", description: "Cash payment checkbox (☑/☐)" },
  { name: "CD", description: "Credit card payment checkbox" },
  { name: "BT", description: "Bank transfer payment checkbox" },
  { name: "CK", description: "Cheque payment checkbox" },
  { name: "BankTransferDateF", description: "Bank transfer date" },
  { name: "BankTransferRef", description: "Bank transfer reference" },
  { name: "BankName", description: "Cheque bank name" },
  { name: "Branch", description: "Cheque bank branch" },
  { name: "CNo", description: "Cheque number" },
  { name: "CDateF", description: "Cheque date" },
];

const RR3_TOKENS: TokenDoc[] = [
  { name: "HotelName", description: "Hotel name in Thai (on the card title line)" },
  { name: "FirstName", description: "Guest first name" },
  { name: "LastName", description: "Guest surname" },
  { name: "IdBoxes", description: "Thai ID card number as 13 digit boxes (pre-built HTML)" },
  { name: "IdentityCardNumber", description: "Thai ID card number as plain text" },
  { name: "AlienBook", description: "Alien registration book no." },
  { name: "PassportNumber", description: "Passport no." },
  { name: "Occupation", description: "Occupation (default นักธุรกิจ)" },
  { name: "NationalityName", description: "Nationality (Thai name)" },
  { name: "NationalityCode", description: "Nationality country code, e.g. GB" },
  { name: "AddressDetails", description: "Current address" },
  { name: "Telephone", description: "Telephone no." },
  { name: "Email", description: "Guest email" },
  { name: "Departure", description: "Place of departure (1.2, blank by default)" },
  { name: "Destination", description: "Next destination (2.2, blank by default)" },
  { name: "CheckIn", description: "Arrival date (DD/MM/YYYY)" },
  { name: "CheckInTime", description: "Arrival time (HH:MM)" },
  { name: "CheckOut", description: "Expected departure date" },
  { name: "CheckOutTime", description: "Expected departure time" },
  { name: "RoomNumber", description: "Room no." },
  { name: "GuestSign", description: "Guest full name (under the signature line)" },
  { name: "ReservationsNumber", description: "MEWS reservation/confirmation number" },
];

const EMAIL_TOKENS: TokenDoc[] = [
  { name: "FullName", description: "New user's full name (falls back to their email if blank)" },
  { name: "Email", description: "New user's email - also the Google account they should sign in with" },
  { name: "AppLink", description: "The app's sign-in URL (the button and the plain-text link both use this)" },
];

const INTERNAL_WELCOME_EMAIL_TOKENS: TokenDoc[] = [
  { name: "FullName", description: "New user's full name (falls back to their email if blank)" },
  { name: "SetPasswordLink", description: "Single-use Supabase link that lets them choose their password - must stay in the button's href. Removing it sends an email with no way in." },
];

const PASSWORD_RESET_EMAIL_TOKENS: TokenDoc[] = [
  { name: "FullName", description: "Account holder's full name (falls back to their email if blank)" },
  { name: "ResetLink", description: "Single-use Supabase link that lets them choose a new password - must stay in the button's href. Removing it sends an email with no way in." },
];

const GOOGLE_SIGNIN_NOTICE_EMAIL_TOKENS: TokenDoc[] = [
  { name: "FullName", description: "Account holder's full name (falls back to their email if blank)" },
  { name: "AppLink", description: "The app's sign-in URL (the button and the plain-text link both use this)" },
];

const REJECTION_EMAIL_TOKENS: TokenDoc[] = [
  { name: "FullName", description: "The removed/rejected user's full name (falls back to their email if blank)" },
];

const ST_FILES_EMAIL_TOKENS: TokenDoc[] = [
  { name: "Date", description: "Report date (DD/MM/YYYY)" },
  { name: "PropertyCount", description: "Number of properties included in this email" },
  { name: "PropertyList", description: "Comma-separated list of included property names" },
  { name: "StatsTable", description: "Pre-built HTML table, one row per property: Property, Code, Spaces, Occupied, House Uses, Out of Order, Availability, Customers, Arrivals, Departures, Complimentary, No. of Day" },
];

const ST_FILES_EMAIL_PER_PROPERTY_TOKENS: TokenDoc[] = [
  { name: "Date", description: "Report date (DD/MM/YYYY)" },
  { name: "Property", description: "This email's one property name" },
  { name: "PropertyCode", description: "This property's ST Property Code" },
  { name: "StatsTable", description: "Same pre-built HTML table as the bundled email, but with just this one property's row" },
];

const TEMPLATE_CONFIG: Record<TemplateType, {
  label: string;
  endpoint: string;
  tokens: TokenDoc[];
  defaultNote: string;
  tokenNote: string;
  perProperty: boolean;
  hasSubject?: boolean;
  previewable?: boolean;
  // Recipients/Time to Send/Enabled fields + a "Send Test Now" button -
  // only the ST Files Email tab is a scheduled digest rather than a
  // triggered-by-an-action template, so these stay optional or every
  // other tab would need to carry unused schedule fields too.
  hasScheduleFields?: boolean;
  // ST Files Email (Per-Property) only - a per-property Enabled/To/Cc/Bcc
  // panel (each property opts in independently), edited on this tab.
  hasPerPropertyRecipients?: boolean;
}> = {
  billing: {
    label: "Billing",
    endpoint: "/bills/template",
    tokens: BILLING_TOKENS,
    defaultNote: "This property has no saved billing template yet - showing the generic default. Edit the placeholder company details below and save.",
    tokenNote: "Company name/address/Tax ID are not tokens - type them directly since they're fixed per property.",
    perProperty: true,
    previewable: true,
  },
  rr3: {
    label: "RR3",
    endpoint: "/rr3/template",
    tokens: RR3_TOKENS,
    defaultNote: "No RR3 template saved yet - showing the official-form default. Save to customize it.",
    tokenNote: "Include the <style> block: it controls fonts, the A4 card frame, and page breaks.",
    // The RR3 card is a single fixed government form used by every property -
    // no per-property selector, unlike Billing where each property has its own
    // invoice design.
    perProperty: false,
    previewable: true,
  },
  email: {
    label: "Welcome Email",
    endpoint: "/admin/email-template",
    tokens: EMAIL_TOKENS,
    defaultNote: "No welcome email template saved yet - showing the built-in default. Save to customize it.",
    tokenNote: "Sent when a new Google-auth user is created (Admin > Users > Create New User).",
    perProperty: false,
    hasSubject: true,
    previewable: true,
  },
  internal_welcome_email: {
    label: "Internal Welcome",
    endpoint: "/admin/email-template/internal-welcome",
    tokens: INTERNAL_WELCOME_EMAIL_TOKENS,
    defaultNote: "No Internal Welcome template saved yet - showing the built-in default. Save to customize it.",
    tokenNote: "Sent when a new Internal Auth user is created - carries a single-use set-password link, not a password.",
    perProperty: false,
    hasSubject: true,
    previewable: true,
  },
  password_reset_email: {
    label: "Password Reset",
    endpoint: "/admin/email-template/password-reset",
    tokens: PASSWORD_RESET_EMAIL_TOKENS,
    defaultNote: "No Password Reset template saved yet - showing the built-in default. Save to customize it.",
    tokenNote: "Sent by the login page's \"Forgot password\" link, Internal Auth accounts only.",
    perProperty: false,
    hasSubject: true,
    previewable: true,
  },
  google_signin_notice_email: {
    label: "Google Sign-in Notice",
    endpoint: "/admin/email-template/google-signin-notice",
    tokens: GOOGLE_SIGNIN_NOTICE_EMAIL_TOKENS,
    defaultNote: "No Google Sign-in Notice template saved yet - showing the built-in default. Save to customize it.",
    tokenNote: "Sent instead of a reset link when \"Forgot password\" is used on a Google-auth account.",
    perProperty: false,
    hasSubject: true,
    previewable: true,
  },
  rejection_email: {
    label: "Rejection",
    endpoint: "/admin/email-template/rejection",
    tokens: REJECTION_EMAIL_TOKENS,
    defaultNote: "No Rejection template saved yet - showing the built-in default. Save to customize it.",
    tokenNote: "Sent by Admin > Users > Delete Account.",
    perProperty: false,
    hasSubject: true,
    previewable: true,
  },
  st_files_email: {
    label: "ST Files Email",
    endpoint: "/admin/email-template/st-files-daily",
    tokens: ST_FILES_EMAIL_TOKENS,
    defaultNote: "No ST Files daily email configured yet - showing the built-in default. Save to customize it.",
    tokenNote: "Sent once a day (Time to Send below) with every ready property's ST Files export CSV attached.",
    perProperty: false,
    hasSubject: true,
    previewable: true,
    hasScheduleFields: true,
  },
  st_files_email_per_property: {
    label: "ST Files Email (Per-Property)",
    endpoint: "/admin/email-template/st-files-daily-per-property",
    tokens: ST_FILES_EMAIL_PER_PROPERTY_TOKENS,
    defaultNote: "No per-property ST Files email configured yet - showing the built-in default. Save to customize it.",
    tokenNote: "Any property with Enabled turned on below gets its own separate email using this template instead of joining the bundled ST Files Email for that day's send.",
    perProperty: false,
    hasSubject: true,
    previewable: true,
    hasPerPropertyRecipients: true,
  },
};

// Sample values so the Preview tab shows something readable instead of the
// literal <<Token>> placeholders - real prints/sends substitute the actual
// reservation/guest/user data. IdBoxes mirrors src/lib/rr3Template.ts's own
// digit-box HTML since real templates insert it unescaped, not through
// <<Token>> text substitution.
const PREVIEW_SAMPLE_BUILDERS: Record<TemplateType, () => Record<string, string>> = {
  billing: () => ({
    InvoiceNoF: "INV-2026-001234",
    DateF: "03/08/2026",
    OwnerName: "John Doe",
    AddressLine1: "123 Sukhumvit Road, Khlong Toei",
    AddressLine2: "", AddressLine3: "", AddressLine4: "", AddressLine5: "",
    PostCode: "10110",
    TAXID: "1-2345-67890-12-3",
    No1: "1", Description1: "Room Charge - Deluxe Room", AmountP1: "2,500.00",
    No2: "2", Description2: "Breakfast", AmountP2: "300.00",
    No3: "", Description3: "", AmountP3: "",
    No4: "", Description4: "", AmountP4: "",
    No5: "", Description5: "", AmountP5: "",
    BahtTextE: "สองพันแปดร้อยบาทถ้วน",
    SubTotal: "2,616.82",
    VATC: "7%",
    VAT: "183.18",
    PTC: "1%",
    PT: "26.17",
    NetAmount: "2,800.00",
    CH: "☑", CD: "☐", BT: "☐", CK: "☐",
    BankTransferDateF: "", BankTransferRef: "",
    BankName: "", Branch: "", CNo: "", CDateF: "",
  }),
  rr3: () => ({
    HotelName: "ลับ ดี กรุงเทพ ไชน่าทาวน์",
    FirstName: "John",
    LastName: "Doe",
    IdBoxes: "1234567890123".split("").map((d) => `<span class="s4">${d}</span>`).join(""),
    IdentityCardNumber: "1234567890123",
    AlienBook: "",
    PassportNumber: "AA1234567",
    Occupation: "นักธุรกิจ",
    NationalityName: "อังกฤษ",
    NationalityCode: "GB",
    AddressDetails: "123 Sukhumvit Road, Bangkok",
    Telephone: "081-234-5678",
    Email: "john.doe@example.com",
    Departure: "",
    Destination: "",
    CheckIn: "03/08/2026", CheckInTime: "14:00",
    CheckOut: "05/08/2026", CheckOutTime: "12:00",
    RoomNumber: "306",
    GuestSign: "John Doe",
    ReservationsNumber: "10234567",
    // Not in RR3_TOKENS above (that list documents the guest-data tokens an
    // admin would want to reference) but the real template also uses these
    // checkbox tokens, filled in by the print page's own regCard state, not
    // by a simple <<Token>> lookup - included here purely so Preview doesn't
    // show leftover literal placeholders for them.
    DepartureCurrentChk: "X", DepartureOtherChk: "", DepartureDetail: "",
    DestinationCurrentChk: "X", DestinationOtherChk: "", DestinationDetail: "",
    MarketingConsentChk: "X",
  }),
  email: () => ({
    FullName: "John Doe",
    Email: "john.doe@example.com",
    AppLink: typeof window !== "undefined" ? window.location.origin : "https://one.naraihospitalitygroup.com",
  }),
  internal_welcome_email: () => ({
    FullName: "John Doe",
    SetPasswordLink: "https://one.naraihospitalitygroup.com/reset-password#token=sample",
  }),
  password_reset_email: () => ({
    FullName: "John Doe",
    ResetLink: "https://one.naraihospitalitygroup.com/reset-password#token=sample",
  }),
  google_signin_notice_email: () => ({
    FullName: "John Doe",
    AppLink: typeof window !== "undefined" ? window.location.origin : "https://one.naraihospitalitygroup.com",
  }),
  rejection_email: () => ({
    FullName: "John Doe",
  }),
  st_files_email: () => ({
    Date: "06/08/2026",
    PropertyCount: "8",
    PropertyList: "Lub d Bangkok Chinatown, Lub d Bangkok Siam, Lub d Koh Samui Chaweng Beach, Lub d Koh Tao Tanote Bay, Lub d Philippines Makati, Lub d Phuket Patong, Lub d Siem Reap, Marasca Samui",
    StatsTable: buildStFilesStatsTableSample(),
  }),
  st_files_email_per_property: () => ({
    Date: "06/08/2026",
    Property: "Lub d Bangkok Chinatown",
    PropertyCode: "MS",
    StatsTable: buildStFilesStatsTableSample(1),
  }),
};

// Mirrors sync_service.py's _build_st_files_summary_table byte-for-byte
// (column order, colors, alternating row shading) so the Preview tab shows
// what the real digest actually renders, not a generic placeholder table.
function buildStFilesStatsTableSample(limit?: number): string {
  const columns = ["Spaces", "Occupied", "House Uses", "Out of Order", "Availability", "Customers", "Arrivals", "Departures", "Complimentary", "No. of Day"];
  const allRows = [
    { name: "Lub d Bangkok Chinatown", code: "MS", values: [176, 150, 2, 1, 23, 140, 30, 28, 0, 1] },
    { name: "Lub d Bangkok Siam", code: "SM", values: [88, 84, 0, 4, 0, 83, 32, 31, 0, 1] },
    { name: "Lub d Koh Samui Chaweng Beach", code: "SU", values: [60, 55, 1, 0, 4, 50, 10, 9, 1, 1] },
    { name: "Lub d Koh Tao Tanote Bay", code: "KT", values: [30, 25, 1, 0, 4, 22, 4, 4, 0, 1] },
    { name: "Lub d Philippines Makati", code: "MK", values: [45, 40, 0, 0, 5, 38, 8, 7, 0, 1] },
    { name: "Lub d Phuket Patong", code: "PT", values: [70, 60, 0, 2, 8, 55, 12, 11, 0, 1] },
    { name: "Lub d Siem Reap", code: "SR", values: [40, 35, 0, 0, 5, 30, 6, 5, 0, 1] },
    { name: "Marasca Samui", code: "S2", values: [20, 15, 0, 0, 5, 13, 3, 2, 0, 1] },
  ];
  const rows = limit ? allRows.slice(0, limit) : allRows;
  const headerCells = columns
    .map((c) => `<th style="padding:8px 6px; text-align:center; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:#FFEFD2; line-height:1.3;">${c}</th>`)
    .join("");
  const bodyRows = rows
    .map((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#FFEFD2";
      const dataCells = r.values
        .map((v) => `<td style="padding:7px 6px; text-align:center; font-size:12px; color:#152A00; font-variant-numeric:tabular-nums;">${v}</td>`)
        .join("");
      return (
        `<tr style="background:${bg}; border-bottom:1px solid rgba(21,42,0,0.08);">` +
        `<td style="padding:7px 10px; text-align:left; font-size:12px; color:#152A00; font-weight:700; white-space:nowrap;">${r.name}</td>` +
        `<td style="padding:7px 6px; text-align:center; font-size:12px; color:#152A00; font-variant-numeric:tabular-nums;">${r.code}</td>` +
        dataCells +
        `</tr>`
      );
    })
    .join("");
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">' +
    '<thead><tr style="background:#152A00;">' +
    '<th style="padding:8px 10px; text-align:left; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:#FFEFD2; white-space:nowrap;">Property</th>' +
    '<th style="padding:8px 6px; text-align:center; font-size:8px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:#FFEFD2;">Code</th>' +
    headerCells +
    "</tr></thead>" +
    `<tbody>${bodyRows}</tbody>` +
    "</table>"
  );
}

function renderPreviewHtml(template: string, sample: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(sample)) {
    result = result.split(`<<${key}>>`).join(value);
  }
  return result;
}

export default function TemplatesPage() {
  const [templateType, setTemplateType] = useState<TemplateType>("billing");
  const [properties, setProperties] = useState<string[]>([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [html, setHtml] = useState("");
  const [subject, setSubject] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");

  // ST Files Email tab only (config.hasScheduleFields) - stored as "HH:MM"
  // and split into send_hour/send_minute on save, matching the native
  // <input type="time"> the rest of the app already uses for date/time entry.
  const [recipients, setRecipients] = useState("");
  const [sendTime, setSendTime] = useState("03:00");
  const [enabled, setEnabled] = useState(true);
  const [sendingTest, setSendingTest] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ST Files Email (Per-Property) tab's own per-property Enabled/To/Cc/Bcc
  // panel (config.hasPerPropertyRecipients) - reads/writes
  // property_api_settings directly, independent of the template save above
  // (different resource, different save action). Each property opts in
  // individually via recipEnabled - there's no single all-or-nothing switch.
  const [recipProperty, setRecipProperty] = useState("");
  const [recipEnabled, setRecipEnabled] = useState(false);
  const [recipTo, setRecipTo] = useState("");
  const [recipCc, setRecipCc] = useState("");
  const [recipBcc, setRecipBcc] = useState("");
  const [recipLoading, setRecipLoading] = useState(false);
  const [recipSaving, setRecipSaving] = useState(false);

  // Resize iframe to fit its content (no scrollbars)
  const handleIframeLoad = () => {
    if (iframeRef.current?.contentDocument) {
      const height = iframeRef.current.contentDocument.documentElement.scrollHeight;
      iframeRef.current.style.height = Math.max(height + 20, 540) + "px";
    }
  };

  // Same-origin path, deliberately NOT NEXT_PUBLIC_API_URL: that env var is set
  // (in Vercel) to a stale API deployment that predates the template endpoints,
  // so requests through it come back {"detail":"Not Found"} while /api on this
  // origin works - the print pages already hardcode /api for the same reason.
  const apiUrl = "/api";
  const config = TEMPLATE_CONFIG[templateType];

  useEffect(() => {
    const fetchProperties = async () => {
      const { data } = await supabase.from("property_api_settings").select("property_name").order("property_name");
      if (data && data.length > 0) {
        const names = data.map((p) => p.property_name);
        setProperties(names);
        setSelectedProperty(names[0]);
        setRecipProperty(names[0]);
      }
    };
    fetchProperties();
  }, []);

  // ST Files Email (Per-Property)'s own To/Cc/Bcc panel - reads/writes
  // property_api_settings directly (same pattern Admin > Sync already uses
  // for this table), independent of the template save above.
  useEffect(() => {
    if (!config.hasPerPropertyRecipients || !recipProperty) return;
    const fetchRecipients = async () => {
      setRecipLoading(true);
      try {
        const { data } = await supabase
          .from("property_api_settings")
          .select("st_files_email_enabled, st_files_email_recipients, st_files_email_cc, st_files_email_bcc")
          .eq("property_name", recipProperty)
          .single();
        setRecipEnabled(!!data?.st_files_email_enabled);
        setRecipTo(data?.st_files_email_recipients || "");
        setRecipCc(data?.st_files_email_cc || "");
        setRecipBcc(data?.st_files_email_bcc || "");
      } finally {
        setRecipLoading(false);
      }
    };
    fetchRecipients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipProperty, templateType]);

  const handleSaveRecipients = async () => {
    if (!recipProperty) return;
    setRecipSaving(true);
    try {
      const { error } = await supabase
        .from("property_api_settings")
        .update({
          st_files_email_enabled: recipEnabled,
          st_files_email_recipients: recipTo,
          st_files_email_cc: recipCc,
          st_files_email_bcc: recipBcc,
        })
        .eq("property_name", recipProperty);
      if (error) throw error;
      alert(`Recipients saved for ${recipProperty}`);
    } catch (err: any) {
      alert("Error saving recipients: " + err.message);
    } finally {
      setRecipSaving(false);
    }
  };

  useEffect(() => {
    if (config.perProperty && !selectedProperty) return;
    const fetchTemplate = async () => {
      setLoading(true);
      try {
        const query = config.perProperty ? `?property_name=${encodeURIComponent(selectedProperty)}` : "";
        const res = await fetch(`${apiUrl}${config.endpoint}${query}`);
        const result = await res.json();
        if (result.status === "success") {
          setHtml(result.data.html_template);
          setSubject(result.data.subject || "");
          setIsDefault(!!result.data.is_default);
          if (config.hasScheduleFields) {
            setRecipients(result.data.recipients || "");
            const h = result.data.send_hour ?? 3;
            const m = result.data.send_minute ?? 0;
            setSendTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
            setEnabled(result.data.enabled !== false);
          }
        } else {
          alert("Error loading template: " + (result.detail || result.message));
        }
      } catch (err: any) {
        alert("Error loading template: " + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProperty, templateType]);

  useEffect(() => {
    setViewMode("preview");
  }, [templateType]);

  const handleSave = async () => {
    if ((config.perProperty && !selectedProperty) || !html.trim()) return;
    if (config.hasSubject && !subject.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, string | number | boolean> = { html_template: html };
      if (config.perProperty) body.property_name = selectedProperty;
      if (config.hasSubject) body.subject = subject;
      if (config.hasScheduleFields) {
        const [h, m] = sendTime.split(":").map(Number);
        body.recipients = recipients;
        body.send_hour = h;
        body.send_minute = m;
        body.enabled = enabled;
      }
      const res = await fetch(`${apiUrl}${config.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result.status === "success") {
        alert(`${config.label} template saved`);
        setIsDefault(false);
      } else {
        alert("Error saving: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Error saving template: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestNow = async () => {
    setSendingTest(true);
    try {
      const res = await fetch(`${apiUrl}/admin/email-template/st-files-daily/send-now`, { method: "POST" });
      const result = await res.json();
      if (result.status === "success") {
        const skippedNote = result.skipped?.length ? `\nSkipped: ${result.skipped.join("; ")}` : "";
        alert(`${result.message}\nIncluded: ${result.included.join(", ") || "none"}${skippedNote}`);
      } else {
        alert("Error sending: " + (result.detail || result.message));
      }
    } catch (err: any) {
      alert("Error sending: " + err.message);
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="p-8 bg-white min-h-screen text-slate-900 font-sans">
      <PageHeader
        title="Templates"
        description="Edit the printable HTML templates per property (Billing, RR3), every system email (account creation, password reset, access rejection), and the daily ST Files export email."
      />

      {/* Own row rather than PageHeader's title-row slot: that row is a
          shrink-0 flex item, so once there were 8 tabs (up from 4) its
          natural one-line width squeezed the title/description column down
          to almost nothing instead of wrapping. flex-wrap here lets the
          pills spill onto a second line on narrower screens instead. */}
      <div className="mt-4 flex flex-wrap bg-slate-100 rounded-2xl p-1 gap-1 w-fit max-w-full">
        {(Object.keys(TEMPLATE_CONFIG) as TemplateType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTemplateType(t)}
            className={`px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${templateType === t ? "bg-white text-[#152A00] shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
          >
            {TEMPLATE_CONFIG[t].label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <div className="bg-white border border-slate-200/80 rounded-[28px] p-8 shadow-[0_20px_60px_-15px_rgba(21,42,0,0.08)]">
          {config.perProperty && (
            <div className="space-y-1.5 mb-6 max-w-sm">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Property</label>
              <select
                value={selectedProperty}
                onChange={(e) => setSelectedProperty(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
              >
                {properties.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          {config.hasPerPropertyRecipients && (
            <div className="mb-6 pb-6 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-700 mb-4">Per-Property Recipients</h3>
              <div className="space-y-1.5 mb-4 max-w-sm">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Property</label>
                <select
                  value={recipProperty}
                  onChange={(e) => setRecipProperty(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                >
                  {properties.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              {recipLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#AAA024]"></div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2.5 mb-4">
                    <button
                      type="button"
                      onClick={() => setRecipEnabled(!recipEnabled)}
                      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors mt-0.5 ${recipEnabled ? "bg-[#AAA024]" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${recipEnabled ? "translate-x-5" : ""}`} />
                    </button>
                    <div>
                      <div className="text-sm font-medium text-slate-700">Enabled for {recipProperty || "this property"}</div>
                      <div className="text-xs text-slate-400 mt-0.5">Send this property its own separate email instead of it joining the bundled ST Files Email.</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">To</label>
                      <input
                        type="text"
                        value={recipTo}
                        onChange={(e) => setRecipTo(e.target.value)}
                        placeholder="e.g. manager@lubd.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Cc</label>
                      <input
                        type="text"
                        value={recipCc}
                        onChange={(e) => setRecipCc(e.target.value)}
                        placeholder="optional"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Bcc</label>
                      <input
                        type="text"
                        value={recipBcc}
                        onChange={(e) => setRecipBcc(e.target.value)}
                        placeholder="optional"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-2 ml-1">Comma-separated for multiple addresses. A property with no To configured is skipped when this mode sends.</p>
                  <button
                    onClick={handleSaveRecipients}
                    disabled={recipSaving}
                    className="mt-4 px-6 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {recipSaving ? "Saving..." : `Save Settings for ${recipProperty || "..."}`}
                  </button>
                </>
              )}
            </div>
          )}

          {isDefault && !loading && (
            <div className="mb-6 flex items-start gap-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-200/70 rounded-2xl px-4 py-3">
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>{config.defaultNote}</span>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
            </div>
          ) : (
            <>
              {config.hasSubject && (
                <div className="space-y-1.5 mb-6">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                  />
                </div>
              )}

              {config.hasScheduleFields && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">To (comma-separated)</label>
                    <input
                      type="text"
                      value={recipients}
                      onChange={(e) => setRecipients(e.target.value)}
                      placeholder="khemmarin.k@lubd.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-1">Time to Send (Asia/Bangkok)</label>
                    <input
                      type="time"
                      value={sendTime}
                      onChange={(e) => setSendTime(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-2.5 md:col-span-2">
                    <button
                      type="button"
                      onClick={() => setEnabled(!enabled)}
                      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${enabled ? "bg-[#AAA024]" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : ""}`} />
                    </button>
                    <span className="text-sm font-medium text-slate-700">Enabled</span>
                  </div>
                </div>
              )}

              {config.previewable && (
                <div className="flex bg-slate-100 rounded-xl p-1 gap-1 mb-4 w-fit">
                  <button
                    onClick={() => setViewMode("preview")}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${viewMode === "preview" ? "bg-white text-[#152A00] shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    Preview
                  </button>
                  <button
                    onClick={() => setViewMode("code")}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${viewMode === "code" ? "bg-white text-[#152A00] shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4-4 4M7 8l-4 4 4 4M14 4l-4 16" /></svg>
                    HTML Code
                  </button>
                </div>
              )}

              {config.previewable && viewMode === "preview" ? (
                <div className="bg-slate-100 rounded-2xl p-5 border border-slate-200/70">
                  <iframe
                    ref={iframeRef}
                    title={`${config.label} preview`}
                    srcDoc={renderPreviewHtml(html, PREVIEW_SAMPLE_BUILDERS[templateType]())}
                    onLoad={handleIframeLoad}
                    className="w-full bg-white rounded-xl border border-slate-200/70 shadow-md"
                    style={{ minHeight: "540px" }}
                  />
                </div>
              ) : (
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  spellCheck={false}
                  className="w-full h-[540px] bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#AAA024]/20 focus:bg-white transition-all text-slate-900"
                />
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-6 w-full py-4 bg-[#AAA024] hover:bg-[#8f871e] text-white rounded-2xl font-bold shadow-xl shadow-[#AAA024]/20 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {saving ? "Saving..." : `Save ${config.label} Template`}
              </button>
              {config.hasScheduleFields && (
                <button
                  onClick={handleSendTestNow}
                  disabled={sendingTest}
                  className="mt-3 w-full py-3.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {sendingTest ? "Sending..." : "Send Test Now"}
                </button>
              )}
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200/80 rounded-[28px] p-6 shadow-[0_20px_60px_-15px_rgba(21,42,0,0.08)]">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-xl bg-[#AAA024]/10 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16M6 8l-4 4 4 4M18 8l4 4-4 4" /></svg>
            </div>
            <h3 className="text-sm font-bold text-slate-700">Available Tokens — {config.label}</h3>
          </div>
          <p className="text-xs text-slate-500 mb-4 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-3 leading-relaxed max-w-2xl">
            Use <code className="bg-white border border-slate-200 px-1 rounded text-[#152A00] font-semibold">{"<<Variable>>"}</code> anywhere in the HTML - it&apos;s replaced with the real data when printed. {config.tokenNote}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
            {config.tokens.map((t) => (
              <div key={t.name} className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                <code className="shrink-0 bg-[#152A00]/[0.06] text-[#152A00] px-1.5 py-0.5 rounded-md font-mono text-[11px] font-bold">{`<<${t.name}>>`}</code>
                <span className="text-slate-500 text-[11px] leading-relaxed pt-0.5">{t.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
