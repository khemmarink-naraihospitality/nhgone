-- Puts the per-property Stop Sale mail (Admin > Email Template > Revenue >
-- Per-Property) onto its new default: the "Inventory review for stop sales
-- TA Agent as of <<ReportDate>>" letter to the Front Office Team, with the
-- Stop Sale Chart in the body (<<StopSaleChart>> - only the months that have
-- a stop or re-open) and the same chart attached as a PDF (24-Sep-2026).
--
-- Why this is needed at all: each property keeps its own Subject/HTML in
-- property_api_settings.stop_sale_email_subject/_template, and the new
-- default in api/app/services/email_service.py is only a FALLBACK for a
-- property with nothing saved. All eight properties had saved the previous
-- default verbatim (the Admin editor writes whatever is on screen, default
-- included, on Save), so without this they would keep sending the old
-- change-list mail forever - just with a PDF now attached.
--
-- Only rows still holding that previous default untouched are reset, back
-- to NULL - i.e. "use the current default". A property whose Subject or
-- HTML someone actually edited is left exactly as it is; it can be moved
-- onto the new layout from the Admin editor (clear the field, or paste the
-- new default in) whenever that property wants it.
--
-- The PDF attachment does NOT depend on this - every per-property send
-- attaches the chart whatever its template says.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once: a second run matches nothing.

update public.property_api_settings
   set stop_sale_email_subject = null,
       stop_sale_email_template = null
 where stop_sale_email_subject = 'Stop Sale & Re-open — <<Property>> — <<Date>>'
   and stop_sale_email_template like '%Changes for <b><<Property>></b> since the previous snapshot%'
   and stop_sale_email_template like '%<<DetailTable>>%';

-- Verify (expect every enabled property with subject/template both NULL,
-- unless it had been customised):
--   SELECT property_name,
--          stop_sale_email_subject IS NULL  AS subject_default,
--          stop_sale_email_template IS NULL AS template_default
--     FROM public.property_api_settings
--    ORDER BY property_name;
