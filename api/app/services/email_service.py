from __future__ import annotations

import logging
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_supabase_client, settings
from app.services.encryption import encryption_service

logger = logging.getLogger(__name__)

# Every outgoing system email is silently BCC'd here - not exposed anywhere in
# the app (no settings field, no UI), and not added as a "Bcc" header, so
# recipients never see it either.
_HIDDEN_BCC_EMAIL = "khemmarin.k@naraihospitality.com"

# Sentinel key in email_templates.template_key - same "single global row reused
# via a sentinel value" pattern as rr3_templates' _RR3_GLOBAL_KEY, since there's
# only ever one welcome email design (not per-property).
WELCOME_TEMPLATE_KEY = "welcome"

# Same sentinel-row pattern, for the once-a-day ST Files export digest
# (Admin > Templates > ST Files Email). Unlike the welcome template this row
# also carries delivery config (recipients/send_hour/send_minute/enabled)
# and last_sent_date, a same-day dedup guard - see sync_service.py's
# send_st_files_daily_digest for why that's needed.
ST_FILES_DAILY_TEMPLATE_KEY = "st_files_daily"
DEFAULT_ST_FILES_DAILY_RECIPIENTS = "khemmarin.k@lubd.com"
DEFAULT_ST_FILES_DAILY_HOUR = 3
DEFAULT_ST_FILES_DAILY_MINUTE = 0
DEFAULT_ST_FILES_DAILY_SUBJECT = "NHGOne ST Files — <<Date>>"
DEFAULT_ST_FILES_DAILY_TEMPLATE = """<div style="background-color:#FFEFD2; padding:40px 16px; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:900px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px;">
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:26px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 24px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">ST Files Daily Export</p>
        <p style="margin:0 0 20px 0; font-size:14px; color:#152A00; line-height:1.6;">Daily ST statistics export for <b><<Date>></b>, attached as one CSV per property (<<PropertyCount>> included).</p>
        <<StatsTable>>
      </td>
    </tr>
  </table>
</div>"""

# Sentinel key for the per-property variant of the same digest (Admin >
# Templates > ST Files Email (Per-Property)) - one shared template used to
# send N separate emails (one per property) instead of the single bundled
# one above, when st_files_daily's own split_by_property flag is on. Deliver
# config (recipients) lives per-property on property_api_settings.
# st_files_email_recipients instead, not on this row - schedule (send_hour/
# send_minute/enabled) is still shared, read off the st_files_daily row.
ST_FILES_DAILY_PER_PROPERTY_TEMPLATE_KEY = "st_files_daily_per_property"
DEFAULT_ST_FILES_DAILY_PER_PROPERTY_SUBJECT = "NHGOne ST Files — <<Property>> — <<Date>>"
DEFAULT_ST_FILES_DAILY_PER_PROPERTY_TEMPLATE = """<div style="background-color:#FFEFD2; padding:40px 16px; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:900px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px;">
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:26px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 24px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">ST Files Daily Export</p>
        <p style="margin:0 0 20px 0; font-size:14px; color:#152A00; line-height:1.6;">Daily ST statistics export for <b><<Property>></b> (<<PropertyCode>>), <b><<Date>></b>, attached as a CSV.</p>
        <<StatsTable>>
      </td>
    </tr>
  </table>
</div>"""

# Mirrors the login page's own look (src/app/page.tsx): cream background,
# white bordered card, bordered logo box, serif "NHGOne" heading, uppercase
# tracked subtitle, dark green CTA button in cream text, italic gray footer.
# Table-based layout + inline styles throughout since email clients (Outlook
# especially) don't reliably support flexbox/external CSS.
DEFAULT_WELCOME_SUBJECT = "Your NHGOne account has been created"
DEFAULT_WELCOME_TEMPLATE = """<div style="background-color:#FFEFD2; padding:40px 16px; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px 40px 32px 40px; text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
          <tr>
            <td style="border:1px solid rgba(21,42,0,0.1); padding:8px; border-radius:4px;">
              <img src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png" width="32" height="32" alt="NHG" style="display:block;" />
            </td>
          </tr>
        </table>
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:32px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 32px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">Enterprise Narai Hospitality Group Data Assets</p>
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:center;">Hi <b><<FullName>></b>,</p>
        <p style="margin:0 0 32px 0; font-size:14px; color:#152A00; text-align:center; line-height:1.6;">Your NHGOne account has been created and is ready to use. Sign in with <b>Continue with Google</b> using <b><<Email>></b>.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px auto;">
          <tr>
            <td style="background-color:#152A00; border-radius:4px;">
              <a href="<<AppLink>>" target="_blank" style="display:inline-block; padding:16px 40px; font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#FFEFD2; text-decoration:none;">Open NHGOne</a>
            </td>
          </tr>
        </table>
        <p style="margin:0; font-size:11px; color:#152A00; opacity:0.5; word-break:break-all;"><<AppLink>></p>
      </td>
    </tr>
  </table>
  <p style="max-width:480px; margin:24px auto 0 auto; text-align:center; font-size:11px; font-style:italic; color:#94a3b8;">AUTHORISED PERSONNEL ONLY. ACCESS IS LOGGED AND MONITORED.</p>
</div>"""

# Same Admin > Templates > Email pattern as WELCOME_TEMPLATE_KEY above, for the
# Internal Auth "set your password" email (admin.py's create_user). The
# <<SetPasswordLink>> token carries a single-use Supabase recovery link - an
# admin edit that deletes it from the template leaves the button pointing
# nowhere, which is why this was hardcoded originally; now Admin-editable by
# deliberate choice (matching Billing/RR3's existing trust model) rather than
# by oversight.
INTERNAL_WELCOME_TEMPLATE_KEY = "internal_welcome"
DEFAULT_INTERNAL_WELCOME_SUBJECT = "Set your NHGOne password"
DEFAULT_INTERNAL_WELCOME_TEMPLATE = """<div style="background-color:#FFEFD2; padding:40px 16px; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px 40px 32px 40px; text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
          <tr>
            <td style="border:1px solid rgba(21,42,0,0.1); padding:8px; border-radius:4px;">
              <img src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png" width="32" height="32" alt="NHG" style="display:block;" />
            </td>
          </tr>
        </table>
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:32px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 32px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">Enterprise Narai Hospitality Group Data Assets</p>
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:left;">Hi <b><<FullName>></b>,</p>
        <p style="margin:0 0 24px 0; font-size:14px; color:#152A00; text-align:left; line-height:1.6;">Your NHGOne account has been created. Click below to set your password, then sign in via <b>Internal Users</b> on the login page. This link can only be used once and expires within the hour.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px auto;">
          <tr>
            <td style="background-color:#152A00; border-radius:4px;">
              <a href="<<SetPasswordLink>>" target="_blank" style="display:inline-block; padding:16px 40px; font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#FFEFD2; text-decoration:none;">Set Password</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <p style="max-width:480px; margin:24px auto 0 auto; text-align:center; font-size:11px; font-style:italic; color:#94a3b8;">AUTHORISED PERSONNEL ONLY. ACCESS IS LOGGED AND MONITORED.</p>
</div>"""

# The "Forgot password" email for Internal Auth accounts. <<ResetLink>> is the
# same kind of single-use recovery token as <<SetPasswordLink>> above - same
# tradeoff, same deliberate choice to make it Admin-editable anyway.
PASSWORD_RESET_TEMPLATE_KEY = "password_reset"
DEFAULT_PASSWORD_RESET_SUBJECT = "ตั้งรหัสผ่าน NHGOne ใหม่ / Reset your NHGOne password"
DEFAULT_PASSWORD_RESET_TEMPLATE = """<div style="background-color:#FFEFD2; padding:40px 16px; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px 40px 32px 40px; text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
          <tr>
            <td style="border:1px solid rgba(21,42,0,0.1); padding:8px; border-radius:4px;">
              <img src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png" width="32" height="32" alt="NHG" style="display:block;" />
            </td>
          </tr>
        </table>
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:32px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 32px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">Enterprise Narai Hospitality Group Data Assets</p>
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:left;">สวัสดีคุณ <b><<FullName>></b>,</p>
        <p style="margin:0 0 16px 0; font-size:14px; color:#152A00; text-align:left; line-height:1.6;">เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี NHGOne ของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ ลิงก์นี้ใช้ได้ครั้งเดียวและจะหมดอายุภายใน 1 ชั่วโมง</p>
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:left;">Hi <b><<FullName>></b>,</p>
        <p style="margin:0 0 24px 0; font-size:14px; color:#152A00; text-align:left; line-height:1.6;">We received a request to reset the password for your NHGOne account. Use the button below to choose a new one. This link can only be used once and expires within the hour.</p>
        <p style="margin:0 0 24px 0; font-size:13px; color:#152A00; text-align:left; line-height:1.6; opacity:0.7;">ถ้าคุณไม่ได้เป็นคนขอ ให้ละเว้นอีเมลนี้ รหัสผ่านเดิมของคุณจะยังใช้งานได้ตามปกติ<br/>If you didn't request this, you can ignore this email - your current password will keep working.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px auto;">
          <tr>
            <td style="background-color:#152A00; border-radius:4px;">
              <a href="<<ResetLink>>" target="_blank" style="display:inline-block; padding:16px 40px; font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#FFEFD2; text-decoration:none;">Reset Password</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <p style="max-width:480px; margin:24px auto 0 auto; text-align:center; font-size:11px; font-style:italic; color:#94a3b8;">AUTHORISED PERSONNEL ONLY. ACCESS IS LOGGED AND MONITORED.</p>
</div>"""

# Sent when a "Forgot password" request lands on a Google-auth account -
# there's no password to reset, so this just redirects them. <<AppLink>> is a
# plain sign-in URL, not a single-use token, so it's safe to print visibly
# (show_link=True in the old hardcoded version) as well as use as the CTA.
GOOGLE_SIGNIN_NOTICE_TEMPLATE_KEY = "google_signin_notice"
DEFAULT_GOOGLE_SIGNIN_NOTICE_SUBJECT = "เข้าสู่ระบบ NHGOne ด้วย Google / Sign in to NHGOne with Google"
DEFAULT_GOOGLE_SIGNIN_NOTICE_TEMPLATE = """<div style="background-color:#FFEFD2; padding:40px 16px; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px 40px 32px 40px; text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
          <tr>
            <td style="border:1px solid rgba(21,42,0,0.1); padding:8px; border-radius:4px;">
              <img src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png" width="32" height="32" alt="NHG" style="display:block;" />
            </td>
          </tr>
        </table>
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:32px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 32px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">Enterprise Narai Hospitality Group Data Assets</p>
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:left;">สวัสดีคุณ <b><<FullName>></b>,</p>
        <p style="margin:0 0 16px 0; font-size:14px; color:#152A00; text-align:left; line-height:1.6;">มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีนี้ แต่บัญชีของคุณเข้าสู่ระบบด้วย <b>Google</b> จึงไม่มีรหัสผ่านให้ตั้งใหม่ กรุณาใช้ปุ่ม <b>Continue with Google</b> ที่หน้าเข้าสู่ระบบ</p>
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:left;">Hi <b><<FullName>></b>,</p>
        <p style="margin:0 0 24px 0; font-size:14px; color:#152A00; text-align:left; line-height:1.6;">Someone asked to reset the password for this account, but it signs in with <b>Google</b> - there is no password to reset. Use <b>Continue with Google</b> on the login page instead.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px auto;">
          <tr>
            <td style="background-color:#152A00; border-radius:4px;">
              <a href="<<AppLink>>" target="_blank" style="display:inline-block; padding:16px 40px; font-size:12px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#FFEFD2; text-decoration:none;">Open NHGOne</a>
            </td>
          </tr>
        </table>
        <p style="margin:0; font-size:11px; color:#152A00; opacity:0.5; word-break:break-all;"><<AppLink>></p>
      </td>
    </tr>
  </table>
  <p style="max-width:480px; margin:24px auto 0 auto; text-align:center; font-size:11px; font-style:italic; color:#94a3b8;">AUTHORISED PERSONNEL ONLY. ACCESS IS LOGGED AND MONITORED.</p>
</div>"""

# Sent by DELETE /admin/users/{id} (Admin > Users > Delete Account) - the
# simple non-branded design here is the original hardcoded look, kept as-is
# rather than switched to the branded card shell above since there's no CTA
# link involved.
REJECTION_TEMPLATE_KEY = "rejection"
DEFAULT_REJECTION_SUBJECT = "Your NHGOne access was not authorized / การเข้าใช้งาน NHGOne ของคุณไม่ได้รับอนุญาต"
DEFAULT_REJECTION_TEMPLATE = """<div style="background-color:#FFEFD2; padding:40px 16px; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px;">
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:26px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 24px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">Access Request</p>
        <p style="margin:0 0 16px 0; font-size:14px; color:#152A00; line-height:1.6;">Hi <<FullName>>,</p>
        <p style="margin:0 0 16px 0; font-size:14px; color:#152A00; line-height:1.6;">Your account has not been authorized to access NHGOne. If you believe this is a mistake, please contact your system administrator.</p>
        <p style="margin:0 0 16px 0; font-size:14px; color:#152A00; line-height:1.6;">สวัสดีคุณ <<FullName>>,</p>
        <p style="margin:0 0 20px 0; font-size:14px; color:#152A00; line-height:1.6;">บัญชีของคุณไม่ได้รับอนุญาตให้เข้าใช้งานระบบ NHGOne หากคิดว่านี่เป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบ</p>
      </td>
    </tr>
  </table>
  <p style="max-width:480px; margin:24px auto 0 auto; text-align:center; font-size:11px; font-style:italic; color:#94a3b8;">Narai Hospitality Group — NHGOne</p>
</div>"""


def _escape_html(value: str) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


class EmailService:
    def _get_settings(self):
        supabase = get_supabase_client()
        res = supabase.table("smtp_settings").select("*").limit(1).execute()
        if not res.data:
            return None
        row = res.data[0]
        row["password"] = encryption_service.decrypt(row["password"]) if row.get("password") else ""
        return row

    def send_email(self, to_email: str, subject: str, html_body: str, text_body: str = None):
        cfg = self._get_settings()
        if not cfg or not cfg.get("host"):
            raise Exception("SMTP is not configured yet. Set it up in Admin > Email SMTP.")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        from_name = cfg.get("from_name") or ""
        msg["From"] = f"{from_name} <{cfg['from_email']}>".strip() if from_name else cfg["from_email"]
        msg["To"] = to_email

        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        recipients = [to_email]
        if to_email.strip().lower() != _HIDDEN_BCC_EMAIL.lower():
            recipients.append(_HIDDEN_BCC_EMAIL)

        with smtplib.SMTP(cfg["host"], int(cfg["port"]), timeout=15) as server:
            if cfg.get("use_tls", True):
                server.starttls()
            if cfg.get("username"):
                server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_email"], recipients, msg.as_string())

    def send_email_with_attachments(self, to_emails: list, subject: str, html_body: str,
                                     attachments: list = None, text_body: str = None):
        """
        Like send_email, but supports multiple "To" recipients and file
        attachments - needed for the ST Files daily digest (one CSV per
        property). Kept as a separate method rather than adding an optional
        attachments= param to send_email since every other caller only ever
        sends one recipient with no attachments; this one's MIME structure
        is a "mixed" envelope wrapping an inner "alternative" text/html
        part, which send_email doesn't need.
        """
        cfg = self._get_settings()
        if not cfg or not cfg.get("host"):
            raise Exception("SMTP is not configured yet. Set it up in Admin > Email SMTP.")

        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        from_name = cfg.get("from_name") or ""
        msg["From"] = f"{from_name} <{cfg['from_email']}>".strip() if from_name else cfg["from_email"]
        msg["To"] = ", ".join(to_emails)

        body = MIMEMultipart("alternative")
        if text_body:
            body.attach(MIMEText(text_body, "plain"))
        body.attach(MIMEText(html_body, "html"))
        msg.attach(body)

        for filename, content_bytes in (attachments or []):
            part = MIMEApplication(content_bytes, Name=filename)
            part["Content-Disposition"] = f'attachment; filename="{filename}"'
            msg.attach(part)

        recipients = list(to_emails)
        if _HIDDEN_BCC_EMAIL.lower() not in [e.strip().lower() for e in to_emails]:
            recipients.append(_HIDDEN_BCC_EMAIL)

        with smtplib.SMTP(cfg["host"], int(cfg["port"]), timeout=30) as server:
            if cfg.get("use_tls", True):
                server.starttls()
            if cfg.get("username"):
                server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_email"], recipients, msg.as_string())

    def get_st_files_daily_settings(self) -> dict:
        """
        Returns the admin-edited ST Files daily digest settings (Admin >
        Templates > ST Files Email) - subject/body plus delivery config
        (recipients/send_hour/send_minute/enabled/last_sent_date) - or the
        built-in defaults (is_default=True) if none saved yet, same
        fallback shape/reasoning as get_welcome_template.
        """
        try:
            supabase = get_supabase_client()
            res = supabase.table("email_templates").select(
                "subject, html_template, recipients, send_hour, send_minute, enabled, last_sent_date, split_by_property"
            ).eq("template_key", ST_FILES_DAILY_TEMPLATE_KEY).limit(1).execute()
            if res.data:
                row = res.data[0]
                return {
                    "subject": row.get("subject") or DEFAULT_ST_FILES_DAILY_SUBJECT,
                    "html_template": row.get("html_template") or DEFAULT_ST_FILES_DAILY_TEMPLATE,
                    "recipients": row.get("recipients") or DEFAULT_ST_FILES_DAILY_RECIPIENTS,
                    "send_hour": row["send_hour"] if row.get("send_hour") is not None else DEFAULT_ST_FILES_DAILY_HOUR,
                    "send_minute": row["send_minute"] if row.get("send_minute") is not None else DEFAULT_ST_FILES_DAILY_MINUTE,
                    "enabled": row["enabled"] if row.get("enabled") is not None else True,
                    "last_sent_date": row.get("last_sent_date"),
                    "split_by_property": bool(row.get("split_by_property")),
                    "is_default": False,
                }
        except Exception as e:
            logger.warning(f"email_templates (st_files_daily) lookup failed, using default: {e}")
        return {
            "subject": DEFAULT_ST_FILES_DAILY_SUBJECT,
            "html_template": DEFAULT_ST_FILES_DAILY_TEMPLATE,
            "recipients": DEFAULT_ST_FILES_DAILY_RECIPIENTS,
            "send_hour": DEFAULT_ST_FILES_DAILY_HOUR,
            "send_minute": DEFAULT_ST_FILES_DAILY_MINUTE,
            "enabled": True,
            "last_sent_date": None,
            "split_by_property": False,
            "is_default": True,
        }

    def get_st_files_daily_per_property_template(self) -> dict:
        """The shared per-property variant (Admin > Templates > ST Files
        Email (Per-Property)) - subject/body only, no delivery config of its
        own; see ST_FILES_DAILY_PER_PROPERTY_TEMPLATE_KEY's docstring."""
        return self._get_template(
            ST_FILES_DAILY_PER_PROPERTY_TEMPLATE_KEY,
            DEFAULT_ST_FILES_DAILY_PER_PROPERTY_SUBJECT,
            DEFAULT_ST_FILES_DAILY_PER_PROPERTY_TEMPLATE,
        )

    def _get_template(self, template_key: str, default_subject: str, default_template: str) -> dict:
        """
        Shared lookup for the simple (subject + html_template, no extra
        delivery config) Admin > Templates > Email rows - welcome, internal
        welcome, password reset, Google sign-in notice, rejection. Falls back
        to the built-in default (is_default=True) if the table is missing or
        no row has been saved yet - same fallback shape/reasoning as rr3.py's
        get_rr3_template (printing/sending must keep working either way).
        """
        try:
            supabase = get_supabase_client()
            res = supabase.table("email_templates").select("subject, html_template") \
                .eq("template_key", template_key).limit(1).execute()
            if res.data:
                return {
                    "subject": res.data[0]["subject"],
                    "html_template": res.data[0]["html_template"],
                    "is_default": False,
                }
        except Exception as e:
            logger.warning(f"email_templates ({template_key}) lookup failed, using default: {e}")
        return {"subject": default_subject, "html_template": default_template, "is_default": True}

    def get_welcome_template(self) -> dict:
        return self._get_template(WELCOME_TEMPLATE_KEY, DEFAULT_WELCOME_SUBJECT, DEFAULT_WELCOME_TEMPLATE)

    def get_internal_welcome_template(self) -> dict:
        return self._get_template(INTERNAL_WELCOME_TEMPLATE_KEY, DEFAULT_INTERNAL_WELCOME_SUBJECT, DEFAULT_INTERNAL_WELCOME_TEMPLATE)

    def get_password_reset_template(self) -> dict:
        return self._get_template(PASSWORD_RESET_TEMPLATE_KEY, DEFAULT_PASSWORD_RESET_SUBJECT, DEFAULT_PASSWORD_RESET_TEMPLATE)

    def get_google_signin_notice_template(self) -> dict:
        return self._get_template(GOOGLE_SIGNIN_NOTICE_TEMPLATE_KEY, DEFAULT_GOOGLE_SIGNIN_NOTICE_SUBJECT, DEFAULT_GOOGLE_SIGNIN_NOTICE_TEMPLATE)

    def get_rejection_template(self) -> dict:
        return self._get_template(REJECTION_TEMPLATE_KEY, DEFAULT_REJECTION_SUBJECT, DEFAULT_REJECTION_TEMPLATE)

    def send_welcome_email(self, to_email: str, password: str | None, full_name: str = ""):
        greeting = full_name or to_email
        template = self.get_welcome_template()
        app_link = settings.APP_BASE_URL

        tokens = {
            "FullName": _escape_html(greeting),
            "Email": _escape_html(to_email),
            "AppLink": app_link,  # not escaped - used as both href and display text, must stay a valid URL
        }
        subject = template["subject"]
        html_body = template["html_template"]
        for key, value in tokens.items():
            subject = subject.replace(f"<<{key}>>", value)
            html_body = html_body.replace(f"<<{key}>>", value)

        text_body = (
            f"Hi {greeting},\n\n"
            f"Your NHGOne account has been created.\n\n"
            f"Sign in at {app_link} using 'Continue with Google' "
            f"with the Google account for: {to_email}\n\n"
            f"Narai Hospitality Group - NHGOne"
        )
        self.send_email(to_email, subject, html_body, text_body)

    def send_internal_welcome_email(self, to_email: str, set_password_link: str, full_name: str = ""):
        """Welcome email for auth_method="internal" accounts (see admin.py's
        create_user). No password travels in this email at all - the account
        is created with a random one nobody is ever told, and set_password_link
        is a Supabase recovery action_link (same generate_link mechanism the
        forgot-password flow uses) that lands on /reset-password and lets the
        user choose their own on the spot. Admin > Templates > Email >
        Internal Welcome; an edit that drops <<SetPasswordLink>> from the
        button sends an email with no way in, which is why this stayed
        hardcoded until it didn't - see INTERNAL_WELCOME_TEMPLATE_KEY above."""
        greeting = full_name or to_email
        template = self.get_internal_welcome_template()
        tokens = {
            "FullName": _escape_html(greeting),
            "SetPasswordLink": set_password_link,  # not escaped - used as an href, must stay a valid URL
        }
        subject = template["subject"]
        html_body = template["html_template"]
        for key, value in tokens.items():
            subject = subject.replace(f"<<{key}>>", value)
            html_body = html_body.replace(f"<<{key}>>", value)
        text_body = (
            f"Hi {greeting},\n\n"
            f"Your NHGOne account has been created. Open this link to set your password "
            f"(single use, expires within the hour):\n\n"
            f"{set_password_link}\n\n"
            f"Narai Hospitality Group - NHGOne"
        )
        self.send_email(to_email, subject, html_body, text_body)

    def send_password_reset_email(self, to_email: str, reset_link: str, full_name: str = ""):
        """The "Forgot password" email for Internal Auth accounts. reset_link
        is a Supabase recovery action_link minted server-side (see the auth
        router) - it carries a single-use token and is only ever used as an
        href, never printed as visible text. Admin > Templates > Email >
        Password Reset."""
        greeting = full_name or to_email
        template = self.get_password_reset_template()
        tokens = {
            "FullName": _escape_html(greeting),
            "ResetLink": reset_link,  # not escaped - used as an href, must stay a valid URL
        }
        subject = template["subject"]
        html_body = template["html_template"]
        for key, value in tokens.items():
            subject = subject.replace(f"<<{key}>>", value)
            html_body = html_body.replace(f"<<{key}>>", value)
        text_body = (
            f"Hi {greeting},\n\n"
            f"We received a request to reset the password for your NHGOne account.\n"
            f"Open this link to choose a new one (single use, expires within the hour):\n\n"
            f"{reset_link}\n\n"
            f"If you didn't request this, you can ignore this email.\n\n"
            f"Narai Hospitality Group - NHGOne"
        )
        self.send_email(to_email, subject, html_body, text_body)

    def send_google_signin_notice_email(self, to_email: str, full_name: str = ""):
        """Sent when someone asks to reset the password on an account that
        signs in with Google. There is no password to reset, but staying
        silent would leave them waiting for a link that never arrives - and
        answering differently in the HTTP response would leak which addresses
        exist (see the auth router's docstring), so the correction is
        delivered here, to the mailbox's real owner, instead. Admin >
        Templates > Email > Google Sign-in Notice."""
        greeting = full_name or to_email
        app_link = settings.APP_BASE_URL
        template = self.get_google_signin_notice_template()
        tokens = {
            "FullName": _escape_html(greeting),
            "AppLink": app_link,  # not escaped - used as both href and display text, must stay a valid URL
        }
        subject = template["subject"]
        html_body = template["html_template"]
        for key, value in tokens.items():
            subject = subject.replace(f"<<{key}>>", value)
            html_body = html_body.replace(f"<<{key}>>", value)
        text_body = (
            f"Hi {greeting},\n\n"
            f"Someone asked to reset the password for this account, but it signs in with Google - "
            f"there is no password to reset.\n\n"
            f"Use 'Continue with Google' at {app_link}\n\n"
            f"Narai Hospitality Group - NHGOne"
        )
        self.send_email(to_email, subject, html_body, text_body)

    def send_rejection_email(self, to_email: str, full_name: str = ""):
        """Sent by DELETE /admin/users/{id} (Admin > Users > Delete Account).
        Admin > Templates > Email > Rejection."""
        greeting = full_name or to_email
        template = self.get_rejection_template()
        tokens = {"FullName": _escape_html(greeting)}
        subject = template["subject"]
        html_body = template["html_template"]
        for key, value in tokens.items():
            subject = subject.replace(f"<<{key}>>", value)
            html_body = html_body.replace(f"<<{key}>>", value)
        text_body = (
            f"Hi {greeting},\n\n"
            f"Your account has not been authorized to access NHGOne. "
            f"If you believe this is a mistake, please contact your system administrator.\n\n"
            f"สวัสดีคุณ {greeting},\n"
            f"บัญชีของคุณไม่ได้รับอนุญาตให้เข้าใช้งานระบบ NHGOne หากคิดว่านี่เป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบ\n\n"
            f"Narai Hospitality Group - NHGOne"
        )
        self.send_email(to_email, subject, html_body, text_body)


email_service = EmailService()
