from fastapi import APIRouter, Depends, HTTPException, Query
from app.deps import get_current_active_user
from pydantic import BaseModel
from app.services.sync_service import sync_service
from app.config import get_supabase_client
from typing import Optional

router = APIRouter(prefix="/rr3", tags=["RR3"], dependencies=[Depends(get_current_active_user)])

# Default ร.ร.๓ Lodger Registration Card layout, matched to the official blank
# form. One card's full HTML including its <style> block, so the admin editor
# controls the entire look. <<Token>> placeholders are substituted per guest on
# the print page; <<IdBoxes>> is inserted as raw HTML (the 13 ID-card digit
# boxes), every other token is HTML-escaped. Tokens must stay literal <<...>>
# here - NOT &lt;&lt;...&gt;&gt; - or substitution silently never matches
# (see the DEFAULT_HTML_TEMPLATE bug fixed in 967dd08).
DEFAULT_RR3_TEMPLATE = """<style>
/* line-height is set explicitly and tight (the app shell's default ~1.5 plus
   the two-line Thai/English structure otherwise pushes the card past one A4
   page, which is what makes the layout drift from the official scan) */
.s1 { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-weight:normal; font-size:14pt; line-height:1.12; }
.s2 { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-weight:bold; font-size:15pt; line-height:1.12; }
.s4 { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-size:13pt; line-height:1; display:inline-block; width:14pt; height:15pt; text-align:center; border:1pt solid black; margin:0 1pt; vertical-align:middle; }
.dash { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-size:14pt; margin:0 1.5pt; vertical-align:middle; }
.chk { display:inline-flex; align-items:center; justify-content:center; overflow:hidden; width:10pt; height:10pt; border:1pt solid black; vertical-align:-1pt; margin-right:4pt; font-size:8pt; font-family:Arial,sans-serif; font-weight:bold; line-height:1; }
.val { font-weight:bold; padding:0 4pt; font-family:"Angsana New","TH Sarabun New",serif; line-height:1.3; display:inline-block; min-width:50pt; border-bottom:1pt solid black; text-align:center; }
.val:empty { padding:0; }
table, tbody { vertical-align:top; overflow:visible; }
.center-table { margin:0 auto; width:210mm; height:297mm; padding:12mm 15mm; box-shadow:0 4px 24px rgba(0,0,0,.30); border:1pt solid black; background:#fff; border-collapse:collapse; page-break-after:always; break-after:page; overflow:hidden; }
.center-table p { margin:4pt 0; }
.indent-1 { padding-left: 30pt; }
.indent-2 { padding-left: 45pt; }
.indent-3 { padding-left: 60pt; }
.indent-4 { padding-left: 80pt; }
@page { size:A4 portrait; margin:0mm; }
@media print {
  html, body { width:210mm; height:297mm; margin:0; padding:0; background:none; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .center-table { box-shadow:none; border:1pt solid black; margin:0; }
  .center-table:last-of-type { page-break-after:auto; break-after:auto; }
}
</style>
<table class="center-table" cellspacing="0">
  <tr>
    <td style="width:100%; border:0pt solid; padding: 15pt 25pt;" colspan="3">
      <p class="s1" style="text-align:right;">ร.ร. ๓</p>
      <p class="s2" style="text-align:center;">บัตรทะเบียนผู้พักโรงแรม <span class="val"><<HotelName>></span></p>
      <p class="s1" style="text-align:center;">(Lodger Registration Card)</p>

      <table style="width:100%; border-collapse:collapse; margin:4pt 0;" cellspacing="0"><tr>
        <td style="width:50%; padding:0; vertical-align:top;"><p class="s1 half" style="display:table; width:100%; margin:0;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">ชื่อตัว (Name)</span><span class="val" style="display:table-cell; width:100%;"><<FirstName>></span></p></td>
        <td style="width:50%; padding:0; vertical-align:top;"><p class="s1 half" style="display:table; width:100%; margin:0;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">ชื่อสกุล (Surname)</span><span class="val" style="display:table-cell; width:100%;"><<LastName>></span></p></td>
      </tr></table>

      <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">เลขประจำตัวประชาชน (Identification Card No.)</span><span class="val" style="display:table-cell; width:100%;"><<IdentityCardNumber>></span></p>

      <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">ใบสำคัญประจำตัวคนต่างด้าวเลขที่ (Alien Registration Book No.)</span><span class="val" style="display:table-cell; width:100%;"><<AlienBook>></span></p>

      <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">หนังสือเดินทางเลขที่ (Passport No.)</span><span class="val" style="display:table-cell; width:100%;"><<PassportNumber>></span></p>

      <table style="width:100%; border-collapse:collapse; margin:4pt 0;" cellspacing="0"><tr>
        <td style="width:50%; padding:0; vertical-align:top;"><p class="s1 half" style="display:table; width:100%; margin:0;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">อาชีพ (Occupation)</span><span class="val" style="display:table-cell; width:100%;"><<Occupation>></span></p></td>
        <td style="width:50%; padding:0; vertical-align:top;"><p class="s1 half" style="display:table; width:100%; margin:0;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">สัญชาติ (Nationality)</span><span class="val" style="display:table-cell; width:100%;"><<NationalityName>></span></p></td>
      </tr></table>

      <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">ที่อยู่ปัจจุบัน (Current Address)</span><span class="val" style="display:table-cell; width:100%;"><<AddressDetails>></span></p>
      <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">หมายเลขโทรศัพท์ (Telephone No.)</span><span class="val" style="display:table-cell; width:100%;"><<Telephone>></span></p>

      <div style="margin-top: 15pt;">
        <p class="s1 indent-1">1. เดินทางมาจากสถานที่ใด (Place of Departure)</p>
        <p class="s1 indent-3"><span class="chk"><<DepartureCurrentChk>></span> 1.1 เดินทางมาจากที่อยู่ปัจจุบันที่เป็นภูมิลำเนาข้างต้น (Depart from the current address above)</p>
        <p class="s1 indent-3"><span class="chk"><<DepartureOtherChk>></span> 1.2 เดินทางมาจากสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ) (Place of Departure) <span class="val"><<Departure>></span></p>
        <p class="s1" style="border-bottom:1pt solid black; height:16pt; margin:4pt 0;"><<DepartureDetail>></p>
        <p style="border-bottom:1pt solid black; height:16pt; margin:4pt 0;">&nbsp;</p>
      </div>

      <div style="margin-top: 15pt; margin-bottom: 20pt;">
        <p class="s1 indent-1">2. ประสงค์จะเดินทางต่อไปยังสถานที่ใด (Next Destination)</p>
        <p class="s1 indent-3"><span class="chk"><<DestinationCurrentChk>></span> 2.1 เดินทางกลับไปยังที่อยู่ปัจจุบันที่เป็นภูมิลำเนา (Back to the current address above)</p>
        <p class="s1 indent-3"><span class="chk"><<DestinationOtherChk>></span> 2.2 เดินทางต่อไปยังสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ) (Next Destination) <span class="val"><<Destination>></span></p>
        <p class="s1" style="border-bottom:1pt solid black; height:16pt; margin:4pt 0;"><<DestinationDetail>></p>
        <p style="border-bottom:1pt solid black; height:16pt; margin:4pt 0;">&nbsp;</p>
      </div>

      <div style="margin-top: 15pt;">
        <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">ที่อยู่อีเมล (Email Address)</span><span class="val" style="display:table-cell; width:100%;"><<Email>></span></p>
        <p class="s1" style="margin-top:10pt;"><span class="chk"><<MarketingConsentChk>></span> I&#39;d like to occasionally receive marketing updates from <<HotelName>></p>
      </div>
    </td>
  </tr>
  <tr style="height:120pt">
    <td style="width:33.33%; border-top:1pt solid black; border-right:1pt solid black; padding: 10pt;">
      <p class="s1" style="text-align:center;">วัน เดือน ปี ที่เข้าพัก (Date of Arrival)</p>
      <p class="s1" style="margin-top: 10pt;"><span class="val" style="display:block; width:100%;"><<CheckIn>></span></p>
      <div style="margin-top: 15pt; padding-left: 10pt;">
        <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">เวลา (Time)</span><span class="val" style="display:table-cell; width:100%;"><<CheckInTime>></span></p>
      </div>
    </td>
    <td style="width:33.33%; border-top:1pt solid black; border-right:1pt solid black; padding: 10pt;">
      <p class="s1" style="text-align:center;">วัน เดือน ปี ที่ออกไป (Expected Departure)</p>
      <p class="s1" style="margin-top: 10pt;"><span class="val" style="display:block; width:100%;"><<CheckOut>></span></p>
      <div style="margin-top: 15pt; padding-left: 10pt;">
        <p class="s1" style="display:table; width:100%;"><span style="display:table-cell; white-space:nowrap; padding-right:4pt;">เวลา (Time)</span><span class="val" style="display:table-cell; width:100%;"><<CheckOutTime>></span></p>
      </div>
    </td>
    <td style="width:33.33%; border-top:1pt solid black; padding: 10pt;">
      <p class="s1" style="padding-left:10pt;">ห้องพักเลขที่ (Room No.)&nbsp;&nbsp;&nbsp;&nbsp;<span class="val"><<RoomNumber>></span></p>
      <p class="s1" style="text-align:center; margin-top: 20pt;">ลายมือชื่อผู้พัก (Guest Signature)</p>
      <p class="s1" style="margin-top:26pt;"><span class="val" style="display:block; width:100%;"><<GuestSign>></span></p>
    </td>
  </tr>
</table>"""

class Rr3TemplateUpdate(BaseModel):
    html_template: str

# The RR3 card is one fixed government form shared by every property (unlike
# billing templates, which vary per property's own invoice design) - so
# rr3_templates stores a single global row rather than one per property. Reuses
# the same table's property_name column as a fixed sentinel key rather than a
# schema change, since only one row is ever expected to exist.
_RR3_GLOBAL_KEY = "__global__"

@router.get("/cards")
async def get_rr3_cards(
    property_name: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    try:
        data = await sync_service.get_rr3_cards(
            property_name=property_name,
            start_date=start_date,
            end_date=end_date,
        )
        return {"status": "success", "data": data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/template")
async def get_rr3_template():
    """
    Returns the single shared RR3 card HTML template (same form for every
    property), or the official-form DEFAULT_RR3_TEMPLATE (with is_default=True)
    if none has been saved yet.
    """
    try:
        supabase = get_supabase_client()
        res = supabase.table("rr3_templates").select("html_template").eq("property_name", _RR3_GLOBAL_KEY).limit(1).execute()
        if res.data:
            return {"status": "success", "data": {"html_template": res.data[0]["html_template"], "is_default": False}}
    except Exception as e:
        # Printing must keep working even if the table is missing (this exact
        # thing happened to billing_templates on 2026-07-07) - fall back to the
        # default form. Saving via POST below still fails loudly, so a missing
        # table is noticed the moment anyone tries to customize.
        print(f"rr3_templates lookup failed, using default template: {e}")
    return {"status": "success", "data": {"html_template": DEFAULT_RR3_TEMPLATE, "is_default": True}}

@router.post("/template")
async def save_rr3_template(request: Rr3TemplateUpdate):
    try:
        supabase = get_supabase_client()
        existing = supabase.table("rr3_templates").select("id").eq("property_name", _RR3_GLOBAL_KEY).limit(1).execute()
        payload = {"property_name": _RR3_GLOBAL_KEY, "html_template": request.html_template}
        if existing.data:
            supabase.table("rr3_templates").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            supabase.table("rr3_templates").insert(payload).execute()
        return {"status": "success", "message": "RR3 template saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
