import re
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.services.sync_service import sync_service
from app.config import get_supabase_client
from typing import Optional

router = APIRouter(prefix="/bills", tags=["Bills"])

_GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

# Generic, obviously-a-placeholder starting point for properties that haven't
# configured their own billing template yet. Company details are static text
# (not tokens) because they vary per property, not per bill - the admin edits
# them directly for each property's own template. Uses inline styles only
# (no Tailwind classes) since this HTML is stored in the DB and injected via
# dangerouslySetInnerHTML - Tailwind's build-time JIT can't see these classes
# to generate CSS for them.
DEFAULT_HTML_TEMPLATE = """<div style="border:1px solid #000;padding:24px;font-size:12px;line-height:1.4;color:#000;background:#fff;font-family:'IBM Plex Sans',sans-serif;">
  <div style="text-align:center;border-bottom:1px solid #000;padding-bottom:8px;margin-bottom:8px;">
    <div style="font-weight:bold;">[Company Name - Thai]</div>
    <div>[Company Name - English]</div>
    <div>[Company Address - Thai]</div>
    <div>[Company Address - English]</div>
    <div>เลขประจำตัวผู้เสียภาษี Tax ID No. [Company Tax ID]</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
    <div>
      <div>เลขที่ / No. : &lt;&lt;InvoiceNoF&gt;&gt;</div>
      <div>วันที่ / Date : &lt;&lt;DateF&gt;&gt;</div>
      <div>เลขที่อ้างอิง / Inv Ref : </div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:bold;">RECEIPT/TAX INVOICE (Original)</div>
      <div>ใบเสร็จรับเงิน / ใบกำกับภาษี (ต้นฉบับ)</div>
    </div>
  </div>
  <div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:8px 0;margin-bottom:8px;">
    <div>ชื่อ / Name : &lt;&lt;OwnerName&gt;&gt;</div>
    <div>ที่อยู่ / Address : &lt;&lt;AddressLine1&gt;&gt; &lt;&lt;AddressLine2&gt;&gt; &lt;&lt;AddressLine3&gt;&gt; &lt;&lt;AddressLine4&gt;&gt; &lt;&lt;AddressLine5&gt;&gt; &lt;&lt;PostCode&gt;&gt;</div>
    <div>เลขประจำตัวผู้เสียภาษี : &lt;&lt;TAXID&gt;&gt;</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <thead>
      <tr>
        <th style="border:1px solid #000;padding:4px;width:48px;">เลขที่<br/>No</th>
        <th style="border:1px solid #000;padding:4px;">รายละเอียด<br/>Description</th>
        <th style="border:1px solid #000;padding:4px;width:112px;">จำนวนเงิน<br/>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No1&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description1&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP1&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No2&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description2&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP2&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No3&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description3&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP3&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No4&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description4&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP4&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No5&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description5&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP5&gt;&gt;</td></tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="3">บาท<br/>Baht</td>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="3">&lt;&lt;BahtTextE&gt;&gt;</td>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>จำนวนเงิน Net Amount</span><span>&lt;&lt;SubTotal&gt;&gt;</span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>VAT (&lt;&lt;VATC&gt;&gt;)</span><span>&lt;&lt;VAT&gt;&gt;</span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;font-weight:bold;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>Total Amount</span><span>&lt;&lt;NetAmount&gt;&gt;</span></div></td>
      </tr>
    </tbody>
  </table>
  <div style="font-weight:bold;margin-bottom:4px;">รับชำระโดย/ Received By :</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <tbody>
      <tr>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;">&lt;&lt;CH&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เงินสด/Cash</td>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;">&lt;&lt;CD&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เครดิตการ์ด/Credit Card</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;BT&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เงินโอน/Bank Transfer &lt;&lt;BankTransferDateF&gt;&gt;<br/>Bank Transfer Ref. &lt;&lt;BankTransferRef&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;CK&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เช็ค/Cheque : ธนาคาร/Bank : &lt;&lt;BankName&gt;&gt;<br/>สาขา/Branch : &lt;&lt;Branch&gt;&gt;<br/>เลขที่/No. : &lt;&lt;CNo&gt;&gt; วันที่/Date : &lt;&lt;CDateF&gt;&gt;</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:10px;margin-bottom:4px;">หากชำระเงินด้วยเช็ค ใบเสร็จรับเงินฉบับนี้จะสมบูรณ์ต่อเมื่อขึ้นเงินตามเช็คได้แล้ว<br/>If payment is made by cheque, this receipt will not be valid until the cheque is honoured by the bank.</p>
  <p style="font-size:10px;margin-bottom:24px;">หากชำระด้วยบัตรเครดิต ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อผู้ถือบัตรยอมจ่ายเงินให้ผู้ออกบัตรแล้ว<br/>If payment is made by Credit Card, this receipt will not be valid until the cardholder pays to the card-issuing office.</p>
  <div style="text-align:right;">
    <div>—------------------------------</div>
    <div>[Signature Name]</div>
    <div>&lt;&lt;DateF&gt;&gt;</div>
  </div>
</div>
<div style="border:1px solid #000;padding:24px;font-size:12px;line-height:1.4;color:#000;background:#fff;font-family:'IBM Plex Sans',sans-serif;margin-top:32px;">
  <div style="text-align:center;border-bottom:1px solid #000;padding-bottom:8px;margin-bottom:8px;">
    <div style="font-weight:bold;">[Company Name - Thai]</div>
    <div>[Company Name - English]</div>
    <div>[Company Address - Thai]</div>
    <div>[Company Address - English]</div>
    <div>เลขประจำตัวผู้เสียภาษี Tax ID No. [Company Tax ID]</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
    <div>
      <div>เลขที่ / No. : &lt;&lt;InvoiceNoF&gt;&gt;</div>
      <div>วันที่ / Date : &lt;&lt;DateF&gt;&gt;</div>
      <div>เลขที่อ้างอิง / Inv Ref : </div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:bold;">RECEIPT/TAX INVOICE (Copy)</div>
      <div>ใบเสร็จรับเงิน / ใบกำกับภาษี (สำเนา)</div>
    </div>
  </div>
  <div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:8px 0;margin-bottom:8px;">
    <div>ชื่อ / Name : &lt;&lt;OwnerName&gt;&gt;</div>
    <div>ที่อยู่ / Address : &lt;&lt;AddressLine1&gt;&gt; &lt;&lt;AddressLine2&gt;&gt; &lt;&lt;AddressLine3&gt;&gt; &lt;&lt;AddressLine4&gt;&gt; &lt;&lt;AddressLine5&gt;&gt; &lt;&lt;PostCode&gt;&gt;</div>
    <div>เลขประจำตัวผู้เสียภาษี : &lt;&lt;TAXID&gt;&gt;</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <thead>
      <tr>
        <th style="border:1px solid #000;padding:4px;width:48px;">เลขที่<br/>No</th>
        <th style="border:1px solid #000;padding:4px;">รายละเอียด<br/>Description</th>
        <th style="border:1px solid #000;padding:4px;width:112px;">จำนวนเงิน<br/>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No1&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description1&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP1&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No2&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description2&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP2&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No3&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description3&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP3&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No4&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description4&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP4&gt;&gt;</td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;No5&gt;&gt;</td><td style="border:1px solid #000;padding:4px;">&lt;&lt;Description5&gt;&gt;</td><td style="border:1px solid #000;padding:4px;text-align:right;">&lt;&lt;AmountP5&gt;&gt;</td></tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="3">บาท<br/>Baht</td>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="3">&lt;&lt;BahtTextE&gt;&gt;</td>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>จำนวนเงิน Net Amount</span><span>&lt;&lt;SubTotal&gt;&gt;</span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>VAT (&lt;&lt;VATC&gt;&gt;)</span><span>&lt;&lt;VAT&gt;&gt;</span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;font-weight:bold;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>Total Amount</span><span>&lt;&lt;NetAmount&gt;&gt;</span></div></td>
      </tr>
    </tbody>
  </table>
  <div style="font-weight:bold;margin-bottom:4px;">รับชำระโดย/ Received By :</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <tbody>
      <tr>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;">&lt;&lt;CH&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เงินสด/Cash</td>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;">&lt;&lt;CD&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เครดิตการ์ด/Credit Card</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;BT&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เงินโอน/Bank Transfer &lt;&lt;BankTransferDateF&gt;&gt;<br/>Bank Transfer Ref. &lt;&lt;BankTransferRef&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;text-align:center;">&lt;&lt;CK&gt;&gt;</td>
        <td style="border:1px solid #000;padding:4px;">เช็ค/Cheque : ธนาคาร/Bank : &lt;&lt;BankName&gt;&gt;<br/>สาขา/Branch : &lt;&lt;Branch&gt;&gt;<br/>เลขที่/No. : &lt;&lt;CNo&gt;&gt; วันที่/Date : &lt;&lt;CDateF&gt;&gt;</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:10px;margin-bottom:4px;">หากชำระเงินด้วยเช็ค ใบเสร็จรับเงินฉบับนี้จะสมบูรณ์ต่อเมื่อขึ้นเงินตามเช็คได้แล้ว<br/>If payment is made by cheque, this receipt will not be valid until the cheque is honoured by the bank.</p>
  <p style="font-size:10px;margin-bottom:24px;">หากชำระด้วยบัตรเครดิต ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อผู้ถือบัตรยอมจ่ายเงินให้ผู้ออกบัตรแล้ว<br/>If payment is made by Credit Card, this receipt will not be valid until the cardholder pays to the card-issuing office.</p>
  <div style="text-align:right;">
    <div>—------------------------------</div>
    <div>[Signature Name]</div>
    <div>&lt;&lt;DateF&gt;&gt;</div>
  </div>
</div>"""


class BillingTemplateUpdate(BaseModel):
    property_name: str
    html_template: str

def _validate_bill_id(bill_id: str):
    """
    MEWS bill ids are GUIDs. A malformed id (e.g. an empty/undefined value that
    slipped through the frontend, or two ids accidentally joined together)
    reaches MEWS's BillIds filter as a plain string and comes back as a cryptic
    "Invalid JSON" deserialization error instead of a clear "bad id" message.
    Catch that here before we ever call MEWS.
    """
    if not bill_id or not _GUID_RE.match(bill_id):
        raise HTTPException(status_code=400, detail=f"Invalid bill id: '{bill_id}' is not a valid MEWS bill GUID.")

@router.get("/live")
async def get_live_bills(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    property_name: Optional[str] = Query(None)
):
    try:
        data = await sync_service.get_mapped_bills(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date
        )
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{bill_id}/invoice")
async def get_bill_invoice(bill_id: str, property_name: Optional[str] = Query(None)):
    _validate_bill_id(bill_id)
    try:
        data = await sync_service.get_bill_invoice(property_name=property_name, bill_id=bill_id)
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{bill_id}/pdf")
async def get_bill_pdf(
    bill_id: str,
    property_name: Optional[str] = Query(None),
    bill_print_event_id: Optional[str] = Query(None),
    pdf_template: Optional[str] = Query(None),
):
    _validate_bill_id(bill_id)
    try:
        result = await sync_service.get_bill_pdf(
            property_name=property_name,
            bill_id=bill_id,
            pdf_template=pdf_template,
            bill_print_event_id=bill_print_event_id,
        )
        if result["ready"]:
            return {"status": "success", "pdf_base64": result["base64"]}
        return {"status": "pending", "bill_print_event_id": result["event_id"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/template")
async def get_billing_template(property_name: str = Query(...)):
    """
    Returns the property's saved HTML billing template, or the generic
    DEFAULT_HTML_TEMPLATE (with is_default=True) if none has been saved yet.
    """
    try:
        supabase = get_supabase_client()
        res = supabase.table("billing_templates").select("html_template").eq("property_name", property_name).limit(1).execute()
        if res.data:
            return {"status": "success", "data": {"html_template": res.data[0]["html_template"], "is_default": False}}
        return {"status": "success", "data": {"html_template": DEFAULT_HTML_TEMPLATE, "is_default": True}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/template")
async def save_billing_template(request: BillingTemplateUpdate):
    try:
        supabase = get_supabase_client()
        existing = supabase.table("billing_templates").select("id").eq("property_name", request.property_name).limit(1).execute()
        payload = {"property_name": request.property_name, "html_template": request.html_template}
        if existing.data:
            supabase.table("billing_templates").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            supabase.table("billing_templates").insert(payload).execute()
        return {"status": "success", "message": "Billing template saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
