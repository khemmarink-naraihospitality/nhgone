"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useParams, useSearchParams } from "next/navigation";
import { Invoice, renderInvoiceTemplate, INVOICE_PRINT_CSS } from "@/lib/invoiceTemplate";

function PermissionErrorBanner({ error }: { error: string }) {
  return (
    <div className="max-w-lg mx-auto mt-16 p-6 border border-amber-300 bg-amber-50 rounded-sm">
      <div className="font-bold text-amber-800 mb-2">
        ไม่สามารถพิมพ์บิลนี้ได้ / Cannot print this bill
      </div>
      <p className="text-sm text-amber-900 mb-3 leading-relaxed">
        MEWS ยังไม่ได้ให้สิทธิ์ "Order Items" กับระบบสำหรับพร็อพเพอร์ตี้นี้
        จึงไม่สามารถดึงรายการ/ยอดเงิน/VAT ของบิลมาแสดงได้
        <br />
        MEWS has not granted this property&apos;s Connector API integration access to
        Order Items (line-item) data, so the invoice&apos;s items, VAT, and total cannot
        be retrieved.
      </p>
      <p className="text-sm text-amber-900 mb-4 leading-relaxed">
        กรุณาติดต่อผู้ดูแลระบบ MEWS เพื่อเปิดสิทธิ์ "Order Items" ให้กับพร็อพเพอร์ตี้นี้ แล้วลองใหม่อีกครั้ง
        <br />
        Please contact your MEWS account admin to enable the &quot;Order Items&quot; scope
        for this property&apos;s integration, then try again.
      </p>
      <p className="text-xs text-amber-700/70 leading-relaxed break-words">{error}</p>
    </div>
  );
}

export default function PrintBillPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  // Single bill: /print-bill/{id}. Batch: /print-bill/batch?ids=a,b,c - a comma
  // in a path segment can get percent-encoded/decoded inconsistently between
  // client and server, so batch printing uses a query param instead, which
  // URLSearchParams decodes reliably.
  const idParam = params.id as string;
  const idsFromQuery = searchParams.get("ids");
  const billIds = idParam === "batch" && idsFromQuery
    ? idsFromQuery.split(",").filter(Boolean)
    : [idParam].filter(Boolean);
  const property = searchParams.get("property") || "";

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [failed, setFailed] = useState<{ id: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        let okInvoices: Invoice[] = [];
        let failures: { id: string; message: string }[] = [];

        if (billIds.length > 1) {
          // Multi-print: one batched request instead of N separate ones - the
          // backend builds every invoice in a single pass (one cache lookup,
          // one payments/getAll call for the whole batch).
          const params = new URLSearchParams({ ids: billIds.join(","), property_name: property });
          const res = await apiFetch(`/api/bills/invoices-batch?${params.toString()}`);
          const result = await res.json();
          if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to load invoices");
          const byId = result.data as Record<string, Invoice>;
          okInvoices = billIds.filter((id) => byId[id]).map((id) => byId[id]);
          failures = (result.missing as string[] || []).map((id) => ({ id, message: "Bill not found or failed to load" }));
        } else {
          const settled = await Promise.allSettled(
            billIds.map(async (id) => {
              const res = await apiFetch(`/api/bills/${id}/invoice?property_name=${encodeURIComponent(property)}`);
              const result = await res.json();
              if (result.status !== "success") throw new Error(result.message || result.detail || `Failed to load invoice ${id}`);
              return result.data as Invoice;
            })
          );
          settled.forEach((r, i) => {
            if (r.status === "fulfilled") okInvoices.push(r.value);
            else failures.push({ id: billIds[i], message: r.reason?.message || "Unknown error" });
          });
        }

        setInvoices(okInvoices);
        setFailed(failures);
        if (okInvoices.length === 0 && failures.length > 0) {
          setError(failures[0].message);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    if (billIds.length > 0) fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, idsFromQuery, property]);

  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const res = await apiFetch(`/api/bills/template?property_name=${encodeURIComponent(property)}`);
        const result = await res.json();
        if (result.status === "success") {
          setTemplate(result.data.html_template);
        } else {
          // A non-success response (e.g. a 500) still parses as JSON, so this
          // must be checked explicitly - otherwise the page silently sits on
          // "Loading template..." forever with no indication anything failed.
          setTemplateError(result.message || result.detail || "Failed to load billing template");
        }
      } catch (err: any) {
        setTemplateError(err.message || "Failed to load billing template");
      }
    };
    if (property) fetchTemplate();
  }, [property]);

  if (loading) return <div className="p-10 text-center text-sm">Loading invoice{billIds.length > 1 ? "s" : ""}...</div>;

  if (error) {
    const isPermissionError = error.includes("does not have permission enabled for this resource");
    if (isPermissionError) return <PermissionErrorBanner error={error} />;
    return <div className="p-10 text-center text-red-600 text-sm">{error}</div>;
  }

  if (invoices.length === 0) return null;
  if (templateError) return <div className="p-10 text-center text-red-600 text-sm">{templateError}</div>;
  if (!template) return <div className="p-10 text-center text-sm">Loading template...</div>;

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <style>{INVOICE_PRINT_CSS}</style>
      <div className="no-print flex flex-col items-center gap-3 mb-6">
        <button onClick={() => window.print()} className="btn-brand btn-primary">
          Print / Save as PDF {invoices.length > 1 ? `(${invoices.length} bills)` : ""}
        </button>
        {failed.length > 0 && (
          <div className="max-w-lg text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-sm p-3">
            <div className="font-bold mb-1">
              {failed.length} bill{failed.length > 1 ? "s" : ""} could not be loaded and {failed.length > 1 ? "are" : "is"} excluded below:
            </div>
            <ul className="list-disc list-inside">
              {failed.map((f) => (
                <li key={f.id}>{f.id}: {f.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        {invoices.map((inv) => (
          <div
            key={inv.mews_id}
            className="invoice-page"
            dangerouslySetInnerHTML={{ __html: renderInvoiceTemplate(template, inv) }}
          />
        ))}
      </div>
    </div>
  );
}
