import re
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel
from app.services.sync_service import sync_service
from app.services.encryption import encryption_service
from app.config import get_supabase_client
from typing import Optional
from datetime import datetime, timezone

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
      <div>เลขที่ / No. : <<InvoiceNoF>></div>
      <div>วันที่ / Date : <<DateF>></div>
      <div>เลขที่อ้างอิง / Inv Ref : </div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:bold;">RECEIPT/TAX INVOICE (Original)</div>
      <div>ใบเสร็จรับเงิน / ใบกำกับภาษี (ต้นฉบับ)</div>
    </div>
  </div>
  <div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:8px 0;margin-bottom:8px;">
    <div>ชื่อ / Name : <<OwnerName>></div>
    <div>ที่อยู่ / Address : <<AddressLine1>> <<AddressLine2>> <<AddressLine3>> <<AddressLine4>> <<AddressLine5>> <<PostCode>></div>
    <div>เลขประจำตัวผู้เสียภาษี : <<TAXID>></div>
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
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No1>></td><td style="border:1px solid #000;padding:4px;"><<Description1>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP1>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No2>></td><td style="border:1px solid #000;padding:4px;"><<Description2>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP2>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No3>></td><td style="border:1px solid #000;padding:4px;"><<Description3>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP3>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No4>></td><td style="border:1px solid #000;padding:4px;"><<Description4>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP4>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No5>></td><td style="border:1px solid #000;padding:4px;"><<Description5>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP5>></td></tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="4">บาท<br/>Baht</td>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="4"><<BahtTextE>></td>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>จำนวนเงิน Net Amount</span><span><<SubTotal>></span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>Provincial Tax (<<PTC>>)</span><span><<PT>></span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>VAT (<<VATC>>)</span><span><<VAT>></span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;font-weight:bold;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>Total Amount</span><span><<NetAmount>></span></div></td>
      </tr>
    </tbody>
  </table>
  <div style="font-weight:bold;margin-bottom:4px;">รับชำระโดย/ Received By :</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <tbody>
      <tr>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;"><<CH>></td>
        <td style="border:1px solid #000;padding:4px;">เงินสด/Cash</td>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;"><<CD>></td>
        <td style="border:1px solid #000;padding:4px;">เครดิตการ์ด/Credit Card</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;text-align:center;"><<BT>></td>
        <td style="border:1px solid #000;padding:4px;">เงินโอน/Bank Transfer <<BankTransferDateF>><br/>Bank Transfer Ref. <<BankTransferRef>></td>
        <td style="border:1px solid #000;padding:4px;text-align:center;"><<CK>></td>
        <td style="border:1px solid #000;padding:4px;">เช็ค/Cheque : ธนาคาร/Bank : <<BankName>><br/>สาขา/Branch : <<Branch>><br/>เลขที่/No. : <<CNo>> วันที่/Date : <<CDateF>></td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:10px;margin-bottom:4px;">หากชำระเงินด้วยเช็ค ใบเสร็จรับเงินฉบับนี้จะสมบูรณ์ต่อเมื่อขึ้นเงินตามเช็คได้แล้ว<br/>If payment is made by cheque, this receipt will not be valid until the cheque is honoured by the bank.</p>
  <p style="font-size:10px;margin-bottom:24px;">หากชำระด้วยบัตรเครดิต ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อผู้ถือบัตรยอมจ่ายเงินให้ผู้ออกบัตรแล้ว<br/>If payment is made by Credit Card, this receipt will not be valid until the cardholder pays to the card-issuing office.</p>
  <div style="text-align:right;">
    <div>—------------------------------</div>
    <div>[Signature Name]</div>
    <div><<DateF>></div>
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
      <div>เลขที่ / No. : <<InvoiceNoF>></div>
      <div>วันที่ / Date : <<DateF>></div>
      <div>เลขที่อ้างอิง / Inv Ref : </div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:bold;">RECEIPT/TAX INVOICE (Copy)</div>
      <div>ใบเสร็จรับเงิน / ใบกำกับภาษี (สำเนา)</div>
    </div>
  </div>
  <div style="border-top:1px solid #000;border-bottom:1px solid #000;padding:8px 0;margin-bottom:8px;">
    <div>ชื่อ / Name : <<OwnerName>></div>
    <div>ที่อยู่ / Address : <<AddressLine1>> <<AddressLine2>> <<AddressLine3>> <<AddressLine4>> <<AddressLine5>> <<PostCode>></div>
    <div>เลขประจำตัวผู้เสียภาษี : <<TAXID>></div>
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
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No1>></td><td style="border:1px solid #000;padding:4px;"><<Description1>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP1>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No2>></td><td style="border:1px solid #000;padding:4px;"><<Description2>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP2>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No3>></td><td style="border:1px solid #000;padding:4px;"><<Description3>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP3>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No4>></td><td style="border:1px solid #000;padding:4px;"><<Description4>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP4>></td></tr>
      <tr><td style="border:1px solid #000;padding:4px;text-align:center;"><<No5>></td><td style="border:1px solid #000;padding:4px;"><<Description5>></td><td style="border:1px solid #000;padding:4px;text-align:right;"><<AmountP5>></td></tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="4">บาท<br/>Baht</td>
        <td style="border:1px solid #000;padding:4px;vertical-align:top;" rowspan="4"><<BahtTextE>></td>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>จำนวนเงิน Net Amount</span><span><<SubTotal>></span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>Provincial Tax (<<PTC>>)</span><span><<PT>></span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>VAT (<<VATC>>)</span><span><<VAT>></span></div></td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:0;font-weight:bold;"><div style="display:flex;justify-content:space-between;padding:0 4px;"><span>Total Amount</span><span><<NetAmount>></span></div></td>
      </tr>
    </tbody>
  </table>
  <div style="font-weight:bold;margin-bottom:4px;">รับชำระโดย/ Received By :</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
    <tbody>
      <tr>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;"><<CH>></td>
        <td style="border:1px solid #000;padding:4px;">เงินสด/Cash</td>
        <td style="border:1px solid #000;padding:4px;width:32px;text-align:center;"><<CD>></td>
        <td style="border:1px solid #000;padding:4px;">เครดิตการ์ด/Credit Card</td>
      </tr>
      <tr>
        <td style="border:1px solid #000;padding:4px;text-align:center;"><<BT>></td>
        <td style="border:1px solid #000;padding:4px;">เงินโอน/Bank Transfer <<BankTransferDateF>><br/>Bank Transfer Ref. <<BankTransferRef>></td>
        <td style="border:1px solid #000;padding:4px;text-align:center;"><<CK>></td>
        <td style="border:1px solid #000;padding:4px;">เช็ค/Cheque : ธนาคาร/Bank : <<BankName>><br/>สาขา/Branch : <<Branch>><br/>เลขที่/No. : <<CNo>> วันที่/Date : <<CDateF>></td>
      </tr>
    </tbody>
  </table>
  <p style="font-size:10px;margin-bottom:4px;">หากชำระเงินด้วยเช็ค ใบเสร็จรับเงินฉบับนี้จะสมบูรณ์ต่อเมื่อขึ้นเงินตามเช็คได้แล้ว<br/>If payment is made by cheque, this receipt will not be valid until the cheque is honoured by the bank.</p>
  <p style="font-size:10px;margin-bottom:24px;">หากชำระด้วยบัตรเครดิต ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อผู้ถือบัตรยอมจ่ายเงินให้ผู้ออกบัตรแล้ว<br/>If payment is made by Credit Card, this receipt will not be valid until the cardholder pays to the card-issuing office.</p>
  <div style="text-align:right;">
    <div>—------------------------------</div>
    <div>[Signature Name]</div>
    <div><<DateF>></div>
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

@router.post("/sync-manual")
async def sync_manual_bills(payload: dict = Body(...)):
    """
    Backfills bills_sync with full Bill + Order Item data for a property/date
    range. Unlike the other sections' sync-manual endpoints, this does NOT take
    already-fetched frontend data - the payload only carries the property/date
    range, and this re-fetches via get_mapped_bills_with_items directly, since
    the live list view (get_mapped_bills) deliberately omits order items to
    stay fast, but the Data Mart archive needs them.
    """
    try:
        property_name = payload.get("property")
        start_date = payload.get("start_date")
        end_date = payload.get("end_date")

        property_id = None
        try:
            prop_res = sync_service.supabase.table("property_api_settings").select("id").ilike("property_name", f"%{property_name}%").execute()
            if prop_res.data:
                property_id = prop_res.data[0].get("id")
        except Exception as e:
            print(f"Logging fetch error (bills): {str(e)}")

        bills_data = await sync_service.get_mapped_bills_with_items(
            property_name=property_name, start_date=start_date, end_date=end_date
        )

        now_iso = datetime.now(timezone.utc).isoformat()
        report_date = start_date.split("T")[0] if start_date else None

        batch = []
        for b in bills_data:
            mews_id = b.get("mews_id")
            if not mews_id:
                continue
            batch.append({
                "mews_id": mews_id,
                "property": property_name,
                "data": encryption_service.encrypt_data(b),
                "synced_at": now_iso,
                "report_date": report_date
            })

        inserted = 0
        if batch:
            chunk_size = 200
            for i in range(0, len(batch), chunk_size):
                chunk = batch[i:i + chunk_size]
                try:
                    sync_service.supabase.table("bills_sync").upsert(chunk, on_conflict="mews_id").execute()
                except Exception as e:
                    if "timeout" in str(e).lower():
                        mini_size = chunk_size // 2
                        for j in range(0, len(chunk), mini_size):
                            sync_service.supabase.table("bills_sync").upsert(chunk[j:j + mini_size], on_conflict="mews_id").execute()
                    else:
                        raise
            inserted = len(batch)

            try:
                log_payload = {
                    "property": property_name,
                    "status": "success",
                    "message": f"Manual Bill Import for {report_date or 'Selection'}",
                    "records_synced": inserted,
                    "target_table": "Bills",
                    "sync_type": "manual"
                }
                if property_id:
                    log_payload["property_id"] = property_id
                sync_service.supabase.table("sync_logs").insert(log_payload).execute()
            except Exception as e:
                print(f"Logging insert error (bills): {str(e)}")

        return {"status": "success", "inserted": inserted}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Manual bill sync failed: {str(e)}")

@router.get("/managed")
async def get_managed_bills(
    property: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
):
    try:
        supabase = get_supabase_client()
        query = supabase.table("bills_sync").select("data, synced_at, report_date").order("synced_at", desc=True)
        if property and property != "All" and property != "null":
            query = query.eq("property", property)
        if start_date:
            query = query.gte("report_date", start_date.split("T")[0])
        if end_date:
            query = query.lte("report_date", end_date.split("T")[0])
        query = query.limit(2000)
        res = query.execute()

        data = []
        for r in res.data:
            item = encryption_service.decrypt_data(r["data"])
            item["Import Date"] = r["synced_at"]
            item["report_date"] = r.get("report_date")
            data.append(item)

        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/managed")
async def delete_saved_bills(payload: dict = Body(...)):
    try:
        supabase = get_supabase_client()
        ids = payload.get("mews_ids", [])
        if not ids:
            return {"status": "success", "deleted": 0}
        supabase.table("bills_sync").delete().in_("mews_id", ids).execute()
        return {"status": "success", "deleted": len(ids)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/invoices-batch")
async def get_bill_invoices_batch(ids: str = Query(...), property_name: Optional[str] = Query(None)):
    """
    Multi-print's fast path: builds every requested invoice in one shot (one
    bills_sync cache lookup, one payments/getAll call for the whole batch)
    instead of the frontend firing N separate /{bill_id}/invoice requests -
    see get_bill_invoices_batch in sync_service.py for why that matters.
    ids is a comma-separated list of bill GUIDs (query param, not a path
    segment, so commas can't get mangled by inconsistent encoding).
    """
    bill_ids = [i for i in ids.split(",") if i]
    for bid in bill_ids:
        _validate_bill_id(bid)
    try:
        data = await sync_service.get_bill_invoices_batch(property_name=property_name, bill_ids=bill_ids)
        missing = [b for b in bill_ids if b not in data]
        return {"status": "success", "data": data, "missing": missing}
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
