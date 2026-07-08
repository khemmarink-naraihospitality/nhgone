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

// Layout matched to the official Thai Hotel Act ร.ร.๓ blank form (user-supplied
// scan, 2026-07-08): all four checkboxes (1.1/1.2/2.1/2.2) render empty for the
// guest to tick by hand, English labels sit on their own line under the Thai
// text, and there's no Email/Confirmation Number line - the original Google
// Script port had pre-ticked 1.1/2.1, inline English labels, and both extra
// lines, which the user asked to remove in favor of the official layout.
// Injected via dangerouslySetInnerHTML for exact fidelity on a legal document.
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
    if (p < pattern.length - 1) idBoxesHtml += `<span class="dash">-</span>`;
  });

  const dotted = '<p class="s1">............................................................................................................................................................................................</p>';

  const rows: string[] = [];
  rows.push('<table class="center-table" cellspacing="0">');
  rows.push('<tr><td style="width:100%;border:0pt solid;" colspan="3">');
  rows.push('<p class="s1" style="padding-right:5pt;text-align:right;">ร.ร. ๓</p>');
  rows.push(`<p class="s2" style="text-align:center;">บัตรทะเบียนผู้พักโรงแรม.............<span class="val">${escapeHtml(d.HotelName)}</span>.............</p>`);
  rows.push('<p class="s1" style="text-align:center;">(Lodger Registration Card)</p>');
  rows.push(`<p class="s1">ชื่อตัว ....................<span class="val">${escapeHtml(d.FirstName)}</span>.................... ชื่อสกุล ....................<span class="val">${escapeHtml(d.LastName)}</span>....................</p>`);
  rows.push('<p class="s1">(Name)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Surname)</p>');
  rows.push(`<p class="s1">เลขประจำตัวประชาชน&nbsp;&nbsp;${idBoxesHtml}</p>`);
  rows.push('<p class="s1">(Identification Card No.)</p>');
  rows.push(`<p class="s1">ใบสำคัญประจำตัวคนต่างด้าวเลขที่........................................<span class="val">${escapeHtml(d.AlienBook)}</span>...............................................................</p>`);
  rows.push('<p class="s1">(Alien Registration Book No.)</p>');
  rows.push(`<p class="s1">หนังสือเดินทางเลขที่..............................................<span class="val">${escapeHtml(d.PassportNumber)}</span>........................................................................</p>`);
  rows.push('<p class="s1">(Passport No.)</p>');
  rows.push(`<p class="s1">อาชีพ......................<span class="val">${escapeHtml(d.Occupation)}</span>.......................สัญชาติ ......................<span class="val">${escapeHtml(d.NationalityName)}</span>............................</p>`);
  rows.push('<p class="s1">(Occupation)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Nationality)</p>');
  rows.push(`<p class="s1">ที่อยู่ปัจจุบัน.....................................<span class="val">${escapeHtml(d.AddressDetails)}</span>...............................................................................</p>`);
  rows.push('<p class="s1">(Current Address)</p>');
  rows.push(`<p class="s1">........................................................................หมายเลขโทรศัพท์.................<span class="val">${escapeHtml(d.Telephone)}</span>.......................</p>`);
  rows.push('<p class="s1" style="text-align:center;">(Telephone No.)</p>');
  rows.push('<p class="s1" style="padding-left:30pt;">1. เดินทางมาจากสถานที่ใด</p>');
  rows.push('<p class="s1" style="padding-left:46pt;">(Place of Departure)</p>');
  rows.push('<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 1.1 เดินทางมาจากที่อยู่ปัจจุบันที่เป็นภูมิลำเนาข้างต้น.</p>');
  rows.push('<p class="s1" style="padding-left:82pt;">(Depart from the current address above)</p>');
  rows.push(`<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 1.2 เดินทางมาจากสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ) ..............<span class="val">${escapeHtml(d.Departure)}</span>..............</p>`);
  rows.push('<p class="s1" style="padding-left:82pt;">(Place of Departure)</p>');
  rows.push(dotted);
  rows.push(dotted);
  rows.push('<p class="s1" style="padding-left:30pt;">2. ประสงค์จะเดินทางต่อไปยังสถานที่ใด</p>');
  rows.push('<p class="s1" style="padding-left:46pt;">(Next Destination)</p>');
  rows.push('<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 2.1 เดินทางกลับไปยังที่อยู่ปัจจุบันที่เป็นภูมิลำเนา</p>');
  rows.push('<p class="s1" style="padding-left:82pt;">(Back to the current address above)</p>');
  rows.push(`<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 2.2 เดินทางต่อไปยังสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ)..............<span class="val">${escapeHtml(d.Destination)}</span>..............</p>`);
  rows.push('<p class="s1" style="padding-left:82pt;">(Next Destination)</p>');
  rows.push(dotted);
  rows.push(dotted);
  rows.push("</td></tr>");
  rows.push('<tr style="height:120pt">');
  rows.push(`<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="text-align:center;">วัน เดือน ปี</p><p class="s1" style="text-align:center;">ที่เข้าพัก</p><p class="s1" style="text-align:center;">(Date of Arrival)</p><p class="s1" style="text-align:center;">.......<span class="val">${escapeHtml(d.CheckIn)}</span>.......</p><p class="s1" style="padding-left:10pt;">เวลา ........<span class="val">${escapeHtml(d.CheckInTime)}</span>........</p><p class="s1" style="padding-left:10pt;">(Time)</p></td>`);
  rows.push(`<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="text-align:center;">วัน เดือน ปี</p><p class="s1" style="text-align:center;">ที่ออกไป</p><p class="s1" style="text-align:center;">(Expected Departure)</p><p class="s1" style="text-align:center;">.......<span class="val">${escapeHtml(d.CheckOut)}</span>.......</p><p class="s1" style="padding-left:10pt;">เวลา ........<span class="val">${escapeHtml(d.CheckOutTime)}</span>........</p><p class="s1" style="padding-left:10pt;">(Time)</p></td>`);
  rows.push(`<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="padding-left:6pt;">ห้องพักเลขที่............<span class="val">${escapeHtml(d.RoomNumber)}</span>............</p><p class="s1" style="padding-left:6pt;">(Room No.)</p><p class="s1" style="text-align:center;">ลายมือชื่อผู้พัก</p><p class="s1" style="text-align:center;">(Guest Signature)</p><p class="s1" style="padding-top:12pt;text-align:center;">..............................................</p><p class="s1" style="text-align:center;"><span class="val">${escapeHtml(d.GuestSign)}</span></p></td>`);
  rows.push("</tr></table>");
  return rows.join("");
}

const RR3_STYLES = `
.s1 { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-weight:normal; font-size:14pt; }
.s2 { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-weight:bold; font-size:15pt; }
.s4 { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-size:14pt; display:inline-block; width:16pt; height:17pt; text-align:center; border:1pt solid black; margin:0 1.5pt; vertical-align:middle; }
.dash { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-size:14pt; margin:0 2pt; }
.chk { display:inline-block; width:9pt; height:9pt; border:1pt solid black; vertical-align:-1pt; margin-right:3pt; }
.val { font-weight:bold; padding:0 4pt; font-family:"Angsana New","TH Sarabun New",serif; font-size:14pt; }
table, tbody { vertical-align:top; overflow:visible; }
.center-table { margin:0 auto; width:210mm; height:297mm; padding:14mm 15mm; box-shadow:0 4px 24px rgba(0,0,0,.30); border:1pt solid black; background:#fff; border-collapse:collapse; page-break-after:always; break-after:page; }
.center-table p { margin:1.5pt 0; }
@page { size:A4 portrait; margin:0mm; }
@media print {
  html, body { width:210mm; height:297mm; margin:0; padding:0; background:none; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .center-table { box-shadow:none; border:1pt solid black; margin:0; }
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
