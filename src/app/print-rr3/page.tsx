"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Rr3Card {
  CardId: string;
  ReservationsNumber: string;
  HotelName: string;
  FirstName: string;
  LastName: string;
  RoomNumber: string;
  CheckIn: string;
  CheckInTime: string;
  CheckOut: string;
  CheckOutTime: string;
  PassportNumber: string;
  IdentityCardNumber: string;
  NationalityCode: string;
  NationalityName: string;
  AddressDetails: string;
  Telephone: string;
  Email: string;
  Occupation: string;
  AlienBook: string;
  GuestSign: string;
  Departure: string;
  Destination: string;
}

const escapeHtml = (s: string) =>
  String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Faithful port of the user's proven Google Apps Script's renderCard() - this is
// a fixed Thai Hotel Act form layout, not per-property customizable, so it's a
// direct HTML-string port (not the token-substitution system used for billing
// templates), injected via dangerouslySetInnerHTML for exact fidelity to the
// original (avoids subtle JSX/entity conversion drift on a legal document).
function renderRr3CardHtml(d: Rr3Card): string {
  const idDigits = (d.IdentityCardNumber || "").replace(/\D/g, "");
  const pattern = [1, 4, 5, 2, 1];
  let idx = 0;
  let idBoxesHtml = "";
  pattern.forEach((count, p) => {
    for (let j = 0; j < count; j++) {
      idBoxesHtml += `<span class="s4">${escapeHtml(idDigits[idx] || "")}</span>`;
      idx++;
    }
    if (p < pattern.length - 1) idBoxesHtml += `<span class="s3">-</span>`;
  });

  const rows: string[] = [];
  rows.push('<table class="center-table" cellspacing="0">');
  rows.push('<tr style="min-height:200mm"><td style="width:100%;border:0pt solid;" colspan="3">');
  rows.push(`<h5 style="text-align:right;margin-top:-20px;">Confirmation Number : ..<span>${escapeHtml(d.ReservationsNumber)}</span>..</h5>`);
  rows.push('<p class="s1" style="padding-right:5pt;text-align:right;">ร.ร. ๓</p>');
  rows.push(`<p class="s2" style="text-align:center;">บัตรทะเบียนผู้พักโรงแรม <span>${escapeHtml(d.HotelName)}.</span></p>`);
  rows.push('<p class="s1" style="text-align:center;">(Lodger Registration Card)</p>');
  rows.push(`<p class="s1" style="padding-left:5pt;">ชื่อตัว .........................<span class="firstname">${escapeHtml(d.FirstName)}</span>......................... ชื่อสกุล ............................ <span class="lastname">${escapeHtml(d.LastName)}</span> ...............</p>`);
  rows.push('<p class="s1">&nbsp;(Name)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Surname)</p>');
  rows.push(`<p class="s3" style="padding-left:5pt;"><span class="s1">เลขประจำตัวประชาชน</span> <span>${idBoxesHtml}</span></p>`);
  rows.push('<p class="s1" style="padding-left:5pt;">(Identification Card No.)</p>');
  rows.push(`<p class="s1" style="padding-left:5pt;">ใบสำคัญประจำตัวคนต่างด้าว เลขที่ .........................<span class="alienbook">${escapeHtml(d.AlienBook)}</span>........................... (Alien Registration Book No.)</p>`);
  rows.push(`<p class="s1" style="padding-left:5pt;">หนังสือเดินทางเลขที่ ..................................<span class="passport">${escapeHtml(d.PassportNumber)}</span>......................................</p>`);
  rows.push('<p class="s1" style="padding-left:5pt;">(Passport No.)</p>');
  rows.push(`<p class="s1" style="padding-left:5pt;">อาชีพ......................<span class="occupation">${escapeHtml(d.Occupation)}</span>......................... สัญชาติ ........................<span class="nationality">${escapeHtml(d.NationalityName)}</span>................................</p>`);
  rows.push('<p class="s1" style="padding-left:5pt;">(Occupation)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; (Nationality)</p>');
  rows.push(`<p class="s1" style="padding-left:5pt;">ที่อยู่ปัจจุบัน .................<span class="address">${escapeHtml(d.AddressDetails)}</span>............................</p>`);
  rows.push('<p class="s1" style="padding-left:5pt;">(Current Address)</p>');
  rows.push(`<p class="s1" style="padding-left:5pt;">หมายเลขโทรศัพท์ ...................<span class="phone">${escapeHtml(d.Telephone)}</span>.....................</p>`);
  rows.push('<p class="s1" style="padding-left:5pt;">(Telephone No.)</p>');
  rows.push(`<p class="s1">Email : <span>${escapeHtml(d.Email)}</span></p>`);
  rows.push('<p class="s1" style="padding-left:38pt;">1. เดินทางมาจากสถานที่ใด (Place of Departure)</p>');
  rows.push('<p class="s5" style="padding-left:66pt;">&#9745; <span class="s1">1.1 เดินทางมาจากที่อยู่ปัจจุบัน ที่เป็นภูมิลำเนาข้างต้น (Depart from the current address above)</span></p>');
  rows.push(`<p class="s5" style="padding-left:65pt;"> <span class="s1">1.2 เดินทางมาจากสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ) ...........................<span class="departure">${escapeHtml(d.Departure)}</span>...................................... (Place of Departure)</span></p>`);
  rows.push('<p class="s1" style="padding-left:5pt;">.............................................................................................................................................................................................................................................</p>');
  rows.push('<p class="s1" style="padding-left:44pt;">2. ประสงค์จะเดินทางต่อไปยังสถานที่ใด (Next Destination)</p>');
  rows.push('<p class="s5" style="padding-left:65pt;">&#9745; <span class="s1">2.1 เดินทางกลับไปยังที่อยู่ปัจจุบัน ที่เป็นภูมิลำเนา (Back to the current address above)</span></p>');
  rows.push(`<p class="s5" style="padding-left:65pt;"> <span class="s1">2.2 เดินทางต่อไปยังสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ) ....................................<span class="destination">${escapeHtml(d.Destination)}</span> ........................... (Next Destination)</span></p>`);
  rows.push('<p class="s1" style="padding-left:5pt;">.............................................................................................................................................................................................................................................</p>');
  rows.push("</td></tr>");
  rows.push('<tr style="height:120pt">');
  rows.push(`<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="text-align:center;">วัน เดือน ปี ที่เข้าพัก</p><p class="s1" style="text-align:center;">(Date of Arrival)</p><p class="s1" style="text-align:center;"><span class="arrivaldate">${escapeHtml(d.CheckIn)}</span></p><p class="s1" style="text-align:center;">เวลา <span class="arrivaltime">${escapeHtml(d.CheckInTime)}</span></p><p class="s1" style="padding-left:13pt;">(Time)</p></td>`);
  rows.push(`<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="text-align:center;">วัน เดือน ปี ที่ออกไป</p><p class="s1" style="text-align:center;">(Expected Departure)</p><p class="s1" style="text-align:center;"><span class="departdate">${escapeHtml(d.CheckOut)}</span></p><p class="s1" style="text-align:center;">เวลา <span class="departtime">${escapeHtml(d.CheckOutTime)}</span></p><p class="s1" style="padding-left:13pt;">(Time)</p></td>`);
  rows.push(`<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="text-align:center;">ห้องพักเลขที่ ............<span class="roomno">${escapeHtml(d.RoomNumber)}</span>...........</p><p class="s1" style="padding-left:4pt;">(Room No.)</p><p class="s1" style="text-align:center;">ลายมือชื่อผู้พัก (Guest Signature)</p><p class="s1" style="padding-top:14pt;text-align:center;"> ..............................................</p><p class="s1" style="padding-top:5pt;text-align:center;"><span class="guestsign">${escapeHtml(d.GuestSign)}</span></p></td>`);
  rows.push("</tr></table>");
  return rows.join("");
}

const RR3_STYLES = `
.s1 { color:black; font-family:"Angsana New",serif; font-weight:normal; font-size:14pt; }
.s2 { color:black; font-family:"Angsana New",serif; font-weight:bold; font-size:14pt; }
.s3 { color:black; font-family:Symbol,serif; font-size:18pt; }
.s4 { color:black; font-family:"Angsana New",serif; font-size:14pt; display:inline-block; min-width:22px; text-align:center; background:#f7f7f7; border:1.5px solid #e0e0e0; border-radius:4px; margin:0 1px; }
.s5 { color:black; font-family:Wingdings; font-size:14pt; }
table, tbody { vertical-align:top; overflow:visible; }
.center-table { margin:0 auto; width:210mm; height:297mm; padding:15mm; box-shadow:0 4px 24px rgba(0,0,0,.30); border:2pt solid black; background:#fff; border-collapse:collapse; page-break-after:always; break-after:page; }
.firstname,.lastname,.alienbook,.passport,.occupation,.nationality,.address,.phone,.departure,.destination,.arrivaldate,.arrivaltime,.departdate,.departtime,.roomno,.guestsign { background:#f7f7f7; padding:2px 6px; border-radius:4px; font-weight:bold; color:#2a2a2a; font-family:"Angsana New",serif; font-size:14pt; }
@page { size:A4 portrait; margin:0mm; }
@media print {
  html, body { width:210mm; height:297mm; margin:0; padding:0; background:none; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .center-table { box-shadow:none; border:2pt solid black; margin:0; }
  .center-table:last-of-type { page-break-after:auto; break-after:auto; }
}
`;

export default function PrintRr3Page() {
  const searchParams = useSearchParams();
  const property = searchParams.get("property") || "";
  const startDate = searchParams.get("start_date") || "";
  const endDate = searchParams.get("end_date") || "";
  const cardId = searchParams.get("card_id");
  const cardIdsParam = searchParams.get("card_ids");
  const cardIds = cardIdsParam ? cardIdsParam.split(",").filter(Boolean) : null;

  const [cards, setCards] = useState<Rr3Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCards = async () => {
      try {
        const params = new URLSearchParams({
          property_name: property,
          start_date: startDate,
          end_date: endDate,
        });
        const res = await fetch(`/api/rr3/cards?${params.toString()}`);
        const result = await res.json();
        if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to load RR3 cards");
        let data: Rr3Card[] = result.data || [];
        if (cardIds) {
          const idSet = new Set(cardIds);
          data = data.filter((c) => idSet.has(c.CardId));
        } else if (cardId) {
          data = data.filter((c) => c.CardId === cardId);
        }
        setCards(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    if (property) fetchCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property, startDate, endDate, cardId, cardIdsParam]);

  if (loading) return <div className="p-10 text-center text-sm">Loading...</div>;
  if (error) return <div className="p-10 text-center text-red-600 text-sm">{error}</div>;
  if (cards.length === 0) return <div className="p-10 text-center text-sm">No guest cards found for this range.</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#525659", padding: "40px 0" }}>
      <style>{RR3_STYLES}</style>
      <div className="no-print" style={{ position: "fixed", top: 20, right: 20, display: "flex", gap: 10, zIndex: 9999 }}>
        <button onClick={() => window.print()} className="btn-brand btn-primary">
          Print / Save as PDF ({cards.length} card{cards.length > 1 ? "s" : ""})
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        {cards.map((c) => (
          <div key={c.CardId} dangerouslySetInnerHTML={{ __html: renderRr3CardHtml(c) }} />
        ))}
      </div>
    </div>
  );
}
