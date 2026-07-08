from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from app.services.sync_service import sync_service
from app.config import get_supabase_client
from typing import Optional

router = APIRouter(prefix="/rr3", tags=["RR3"])

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
.dash { color:black; font-family:"Angsana New","TH Sarabun New",serif; font-size:14pt; margin:0 1.5pt; }
.chk { display:inline-block; width:9pt; height:9pt; border:1pt solid black; vertical-align:-1pt; margin-right:3pt; }
.val { font-weight:bold; padding:0 4pt; font-family:"Angsana New","TH Sarabun New",serif; font-size:14pt; line-height:1.12; }
.val:empty { padding:0; }
table, tbody { vertical-align:top; overflow:visible; }
.center-table { margin:0 auto; width:210mm; height:297mm; padding:12mm 15mm; box-shadow:0 4px 24px rgba(0,0,0,.30); border:1pt solid black; background:#fff; border-collapse:collapse; page-break-after:always; break-after:page; overflow:hidden; }
.center-table p { margin:1pt 0; }
@page { size:A4 portrait; margin:0mm; }
@media print {
  html, body { width:210mm; height:297mm; margin:0; padding:0; background:none; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .center-table { box-shadow:none; border:1pt solid black; margin:0; }
  .center-table:last-of-type { page-break-after:auto; break-after:auto; }
}
</style>
<table class="center-table" cellspacing="0">
<tr><td style="width:100%;border:0pt solid;" colspan="3">
<p class="s1" style="padding-right:5pt;text-align:right;">ร.ร. ๓</p>
<p class="s2" style="text-align:center;">บัตรทะเบียนผู้พักโรงแรม.............<span class="val"><<HotelName>></span>.............</p>
<p class="s1" style="text-align:center;">(Lodger Registration Card)</p>
<p class="s1">ชื่อตัว ....................<span class="val"><<FirstName>></span>.................... ชื่อสกุล ....................<span class="val"><<LastName>></span>....................</p>
<p class="s1">(Name)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Surname)</p>
<p class="s1">เลขประจำตัวประชาชน&nbsp;&nbsp;<<IdBoxes>></p>
<p class="s1">(Identification Card No.)</p>
<p class="s1">ใบสำคัญประจำตัวคนต่างด้าวเลขที่........................................<span class="val"><<AlienBook>></span>...............................................................</p>
<p class="s1">(Alien Registration Book No.)</p>
<p class="s1">หนังสือเดินทางเลขที่..............................................<span class="val"><<PassportNumber>></span>........................................................................</p>
<p class="s1">(Passport No.)</p>
<p class="s1">อาชีพ......................<span class="val"><<Occupation>></span>.......................สัญชาติ ......................<span class="val"><<NationalityName>></span>............................</p>
<p class="s1">(Occupation)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Nationality)</p>
<p class="s1">ที่อยู่ปัจจุบัน.....................................<span class="val"><<AddressDetails>></span>...............................................................................</p>
<p class="s1">(Current Address)</p>
<p class="s1">........................................................................หมายเลขโทรศัพท์.................<span class="val"><<Telephone>></span>.......................</p>
<p class="s1" style="text-align:center;">(Telephone No.)</p>
<p class="s1" style="padding-left:30pt;">1. เดินทางมาจากสถานที่ใด</p>
<p class="s1" style="padding-left:46pt;">(Place of Departure)</p>
<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 1.1 เดินทางมาจากที่อยู่ปัจจุบันที่เป็นภูมิลำเนาข้างต้น.</p>
<p class="s1" style="padding-left:82pt;">(Depart from the current address above)</p>
<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 1.2 เดินทางมาจากสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ) ..............<span class="val"><<Departure>></span>..............</p>
<p class="s1" style="padding-left:82pt;">(Place of Departure)</p>
<p class="s1">............................................................................................................................................................................................</p>
<p class="s1">............................................................................................................................................................................................</p>
<p class="s1" style="padding-left:30pt;">2. ประสงค์จะเดินทางต่อไปยังสถานที่ใด</p>
<p class="s1" style="padding-left:46pt;">(Next Destination)</p>
<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 2.1 เดินทางกลับไปยังที่อยู่ปัจจุบันที่เป็นภูมิลำเนา</p>
<p class="s1" style="padding-left:82pt;">(Back to the current address above)</p>
<p class="s1" style="padding-left:60pt;"><span class="chk"></span> 2.2 เดินทางต่อไปยังสถานที่พักอื่น (บ้านเลขที่ ตำบล อำเภอ จังหวัด ประเทศ)..............<span class="val"><<Destination>></span>..............</p>
<p class="s1" style="padding-left:82pt;">(Next Destination)</p>
<p class="s1">............................................................................................................................................................................................</p>
<p class="s1">............................................................................................................................................................................................</p>
</td></tr>
<tr style="height:120pt">
<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="text-align:center;">วัน เดือน ปี</p><p class="s1" style="text-align:center;">ที่เข้าพัก</p><p class="s1" style="text-align:center;">(Date of Arrival)</p><p class="s1" style="text-align:center;">.......<span class="val"><<CheckIn>></span>.......</p><p class="s1" style="padding-left:10pt;">เวลา ........<span class="val"><<CheckInTime>></span>........</p><p class="s1" style="padding-left:10pt;">(Time)</p></td>
<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="text-align:center;">วัน เดือน ปี</p><p class="s1" style="text-align:center;">ที่ออกไป</p><p class="s1" style="text-align:center;">(Expected Departure)</p><p class="s1" style="text-align:center;">.......<span class="val"><<CheckOut>></span>.......</p><p class="s1" style="padding-left:10pt;">เวลา ........<span class="val"><<CheckOutTime>></span>........</p><p class="s1" style="padding-left:10pt;">(Time)</p></td>
<td style="width:33%;border:1pt solid;"><br/><p class="s1" style="padding-left:6pt;">ห้องพักเลขที่............<span class="val"><<RoomNumber>></span>............</p><p class="s1" style="padding-left:6pt;">(Room No.)</p><p class="s1" style="text-align:center;">ลายมือชื่อผู้พัก</p><p class="s1" style="text-align:center;">(Guest Signature)</p><p class="s1" style="padding-top:12pt;text-align:center;">..............................................</p><p class="s1" style="text-align:center;"><span class="val"><<GuestSign>></span></p></td>
</tr></table>"""

class Rr3TemplateUpdate(BaseModel):
    property_name: str
    html_template: str

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
async def get_rr3_template(property_name: str = Query(...)):
    """
    Returns the property's saved RR3 card HTML template, or the official-form
    DEFAULT_RR3_TEMPLATE (with is_default=True) if none has been saved yet.
    """
    try:
        supabase = get_supabase_client()
        res = supabase.table("rr3_templates").select("html_template").eq("property_name", property_name).limit(1).execute()
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
        existing = supabase.table("rr3_templates").select("id").eq("property_name", request.property_name).limit(1).execute()
        payload = {"property_name": request.property_name, "html_template": request.html_template}
        if existing.data:
            supabase.table("rr3_templates").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            supabase.table("rr3_templates").insert(payload).execute()
        return {"status": "success", "message": "RR3 template saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
