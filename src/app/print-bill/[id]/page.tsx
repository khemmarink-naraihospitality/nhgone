"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

interface LineItem {
  no: number | "";
  description: string;
  amount: number | "";
}

interface Invoice {
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
  net_amount: number;
  baht_text: string;
  payment_method: { cash: boolean; card: boolean; bank_transfer: boolean; cheque: boolean };
  bank_transfer_ref: string;
  bank_transfer_date: string;
  cheque: { bank_name: string; branch: string; number: string; date: string };
}

const fmtAmount = (v: number | "") => (v === "" ? "" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const fmtDate = (v: string) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

function InvoiceCopy({ inv, label, labelTh }: { inv: Invoice; label: string; labelTh: string }) {
  const box = (checked: boolean) => (checked ? "☑" : "☐");
  return (
    <div className="border border-black p-6 text-[12px] leading-snug text-black bg-white" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div className="text-center border-b border-black pb-2 mb-2">
        <div className="font-bold">บริษัท คอมมอนแอเรีย เกาะเต่า จำกัด (สาขาที่ 00001)</div>
        <div>Common Area Koh Tao Co., Ltd. (Branch No. 00001)</div>
        <div>เลขที่ 53 หมู่ที่ 3 ตำบลเกาะเต่า อำเภอเกาะพะงัน จังหวัด สุราษฎร์ธานี 84360</div>
        <div>53 M.3 Koh Tao, Koh Phangan, Suratthani, Thailand 84360</div>
        <div>เลขประจำตัวผู้เสียภาษี Tax ID No. 0105566073505</div>
      </div>

      <div className="flex justify-between mb-2">
        <div>
          <div>เลขที่ / No. : {inv.number}</div>
          <div>วันที่ / Date : {fmtDate(inv.issued_at)}</div>
          <div>เลขที่อ้างอิง / Inv Ref : </div>
        </div>
        <div className="text-right">
          <div className="font-bold">RECEIPT/TAX INVOICE ({label})</div>
          <div>ใบเสร็จรับเงิน / ใบกำกับภาษี ({labelTh})</div>
        </div>
      </div>

      <div className="border-t border-b border-black py-2 mb-2">
        <div>ชื่อ / Name : {inv.owner_name}</div>
        <div>ที่อยู่ / Address : {inv.address_lines.join(" ")} {inv.post_code}</div>
        <div>เลขประจำตัวผู้เสียภาษี : {inv.tax_id}</div>
      </div>

      <table className="w-full border-collapse mb-2">
        <thead>
          <tr>
            <th className="border border-black p-1 w-12">เลขที่<br />No</th>
            <th className="border border-black p-1">รายละเอียด<br />Description</th>
            <th className="border border-black p-1 w-28">จำนวนเงิน<br />Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.line_items.map((li, i) => (
            <tr key={i}>
              <td className="border border-black p-1 text-center h-6">{li.no}</td>
              <td className="border border-black p-1">{li.description}</td>
              <td className="border border-black p-1 text-right">{fmtAmount(li.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="border border-black p-1 align-top" rowSpan={3}>บาท<br />Baht</td>
            <td className="border border-black p-1 align-top" rowSpan={3}>{inv.baht_text}</td>
            <td className="border border-black p-0">
              <div className="flex justify-between px-1"><span>จำนวนเงิน Net Amount</span><span>{fmtAmount(inv.sub_total)}</span></div>
            </td>
          </tr>
          <tr>
            <td className="border border-black p-0">
              <div className="flex justify-between px-1"><span>VAT ({inv.vat_rate_pct}%)</span><span>{fmtAmount(inv.vat)}</span></div>
            </td>
          </tr>
          <tr>
            <td className="border border-black p-0 font-bold">
              <div className="flex justify-between px-1"><span>Total Amount</span><span>{fmtAmount(inv.net_amount)}</span></div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="font-bold mb-1">รับชำระโดย/ Received By :</div>
      <table className="w-full border-collapse mb-2">
        <tbody>
          <tr>
            <td className="border border-black p-1 w-8 text-center">{box(inv.payment_method.cash)}</td>
            <td className="border border-black p-1">เงินสด/Cash</td>
            <td className="border border-black p-1 w-8 text-center">{box(inv.payment_method.card)}</td>
            <td className="border border-black p-1">เครดิตการ์ด/Credit Card</td>
          </tr>
          <tr>
            <td className="border border-black p-1 text-center">{box(inv.payment_method.bank_transfer)}</td>
            <td className="border border-black p-1">
              เงินโอน/Bank Transfer {fmtDate(inv.bank_transfer_date)}<br />
              Bank Transfer Ref. {inv.bank_transfer_ref}
            </td>
            <td className="border border-black p-1 text-center">{box(inv.payment_method.cheque)}</td>
            <td className="border border-black p-1">
              เช็ค/Cheque : ธนาคาร/Bank : {inv.cheque.bank_name}<br />
              สาขา/Branch : {inv.cheque.branch}<br />
              เลขที่/No. : {inv.cheque.number} วันที่/Date : {fmtDate(inv.cheque.date)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="text-[10px] mb-1">
        หากชำระเงินด้วยเช็ค ใบเสร็จรับเงินฉบับนี้จะสมบูรณ์ต่อเมื่อขึ้นเงินตามเช็คได้แล้ว<br />
        If payment is made by cheque, this receipt will not be valid until the cheque is honoured by the bank.
      </p>
      <p className="text-[10px] mb-6">
        หากชำระด้วยบัตรเครดิต ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อผู้ถือบัตรยอมจ่ายเงินให้ผู้ออกบัตรแล้ว<br />
        If payment is made by Credit Card, this receipt will not be valid until the cardholder pays to the card-issuing office.
      </p>

      <div className="text-right">
        <div>—------------------------------</div>
        <div>Apinya Ladok</div>
        <div>{fmtDate(inv.issued_at)}</div>
      </div>
    </div>
  );
}

export default function PrintBillPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const billId = params.id as string;
  const property = searchParams.get("property") || "";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        const res = await fetch(`/api/bills/${billId}/invoice?property_name=${encodeURIComponent(property)}`);
        const result = await res.json();
        if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to load invoice");
        setInvoice(result.data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    if (billId) fetchInvoice();
  }, [billId, property]);

  if (loading) return <div className="p-10 text-center text-sm">Loading invoice...</div>;
  if (error) return <div className="p-10 text-center text-red-600 text-sm">{error}</div>;
  if (!invoice) return null;

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="no-print flex justify-center mb-6">
        <button onClick={() => window.print()} className="btn-brand btn-primary">
          Print / Save as PDF
        </button>
      </div>
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <InvoiceCopy inv={invoice} label="Original" labelTh="ต้นฉบับ" />
        <InvoiceCopy inv={invoice} label="Copy" labelTh="สำเนา" />
      </div>
    </div>
  );
}
