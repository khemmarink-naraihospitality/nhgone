import { NextRequest } from "next/server";
import { chromium } from "playwright-core";
import { Invoice, renderInvoiceTemplate, INVOICE_PRINT_CSS } from "@/lib/invoiceTemplate";

export const runtime = "nodejs";
export const maxDuration = 60;

async function launchBrowser() {
  const isServerless = !!process.env.VERCEL;
  if (isServerless) {
    // @sparticuz/chromium ships a Linux binary built for AWS Lambda/Vercel's
    // Node runtime - only usable there, not on a local Windows/Mac dev machine.
    const chromiumBinary = (await import("@sparticuz/chromium")).default;
    return chromium.launch({
      args: chromiumBinary.args,
      executablePath: await chromiumBinary.executablePath(),
      headless: true,
    });
  }
  // Local dev: uses the Chromium downloaded via `npx playwright install chromium`.
  return chromium.launch({ headless: true });
}

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") || "";
  const property = req.nextUrl.searchParams.get("property") || "";
  const billIds = idsParam.split(",").filter(Boolean);

  if (billIds.length === 0) {
    return Response.json({ error: "No bill ids provided" }, { status: 400 });
  }

  const origin = req.nextUrl.origin;

  try {
    const [invoicesRes, templateRes] = await Promise.all([
      fetch(`${origin}/api/bills/invoices-batch?ids=${encodeURIComponent(billIds.join(","))}&property_name=${encodeURIComponent(property)}`),
      fetch(`${origin}/api/bills/template?property_name=${encodeURIComponent(property)}`),
    ]);

    const invoicesResult = await invoicesRes.json();
    if (invoicesResult.status !== "success") {
      return Response.json({ error: invoicesResult.message || invoicesResult.detail || "Failed to load invoices" }, { status: 502 });
    }
    const byId = invoicesResult.data as Record<string, Invoice>;
    const invoices = billIds.filter((id) => byId[id]).map((id) => byId[id]);
    if (invoices.length === 0) {
      return Response.json({ error: "None of the requested bills could be loaded" }, { status: 404 });
    }

    const templateResult = await templateRes.json();
    if (templateResult.status !== "success") {
      return Response.json({ error: templateResult.message || templateResult.detail || "Failed to load billing template" }, { status: 502 });
    }
    const template: string = templateResult.data.html_template;

    const bodies = invoices
      .map((inv) => `<div class="invoice-page">${renderInvoiceTemplate(template, inv)}</div>`)
      .join("\n");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; }
  ${INVOICE_PRINT_CSS}
  .wrap { display: flex; flex-direction: column; gap: 32px; }
</style>
</head>
<body>
<div class="wrap">${bodies}</div>
</body>
</html>`;

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      const pdfBuffer = await page.pdf({ printBackground: true, preferCSSPageSize: true });

      const filename = invoices.length > 1 ? `bills-${invoices.length}.pdf` : `bill-${invoices[0].number || invoices[0].mews_id}.pdf`;
      return new Response(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    return Response.json({ error: err.message || "Failed to generate PDF" }, { status: 500 });
  }
}
