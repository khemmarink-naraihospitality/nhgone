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
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; margin:0 auto; background:#ffffff; border:1px solid rgba(21,42,0,0.1); border-radius:4px;">
    <tr>
      <td style="padding:40px 40px 32px 40px;">
        <h1 style="margin:0 0 4px 0; font-family: Georgia, 'Times New Roman', serif; font-size:26px; font-weight:900; color:#152A00; letter-spacing:-0.02em;">NHGOne</h1>
        <p style="margin:0 0 24px 0; font-size:10px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:#152A00; opacity:0.6;">ST Files Daily Export</p>
        <p style="margin:0 0 16px 0; font-size:14px; color:#152A00; line-height:1.6;">Daily ST statistics export for <b><<Date>></b>, attached as one CSV per property (<<PropertyCount>> included).</p>
        <p style="margin:0; font-size:11px; color:#152A00; opacity:0.5;"><<PropertyList>></p>
      </td>
    </tr>
  </table>
</div>"""

# Mirrors the login page's own look (src/app/page.tsx): cream background,
# white bordered card, bordered logo box, serif "NHGOne" heading, uppercase
# tracked subtitle, dark green CTA button in cream text, italic gray footer.
# Table-based layout + inline styles throughout since email clients (Outlook
# especially) don't reliably support flexbox/external CSS.
DEFAULT_WELCOME_SUBJECT = "บัญชี NHGOne ของคุณถูกสร้างแล้ว / Your NHGOne account has been created"
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
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:left;">สวัสดีคุณ <b><<FullName>></b>,</p>
        <p style="margin:0 0 16px 0; font-size:14px; color:#152A00; text-align:left; line-height:1.6;">บัญชีของคุณถูกสร้างในระบบ NHGOne แล้ว ใช้ <b>Continue with Google</b> ด้วยบัญชี Google ที่ลงทะเบียนนี้: <b><<Email>></b></p>
        <p style="margin:0 0 4px 0; font-size:15px; color:#152A00; text-align:left;">Hi <b><<FullName>></b>,</p>
        <p style="margin:0 0 32px 0; font-size:14px; color:#152A00; text-align:left; line-height:1.6;">Your NHGOne account has been created and is ready to use. Sign in with <b>Continue with Google</b> using <b><<Email>></b>.</p>
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
                "subject, html_template, recipients, send_hour, send_minute, enabled, last_sent_date"
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
            "is_default": True,
        }

    def get_welcome_template(self) -> dict:
        """
        Returns the admin-edited welcome email (Admin > Templates > Email),
        or the built-in default (with is_default=True) if none has been
        saved yet - same fallback shape/reasoning as rr3.py's
        get_rr3_template (printing/sending must keep working even if the
        table is missing or empty).
        """
        try:
            supabase = get_supabase_client()
            res = supabase.table("email_templates").select("subject, html_template") \
                .eq("template_key", WELCOME_TEMPLATE_KEY).limit(1).execute()
            if res.data:
                return {
                    "subject": res.data[0]["subject"],
                    "html_template": res.data[0]["html_template"],
                    "is_default": False,
                }
        except Exception as e:
            logger.warning(f"email_templates lookup failed, using default template: {e}")
        return {"subject": DEFAULT_WELCOME_SUBJECT, "html_template": DEFAULT_WELCOME_TEMPLATE, "is_default": True}

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

    def send_rejection_email(self, to_email: str, full_name: str = ""):
        greeting = full_name or to_email
        subject = "Your NHGOne access was not authorized / การเข้าใช้งาน NHGOne ของคุณไม่ได้รับอนุญาต"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #152A00;">
          <h2 style="color: #152A00;">NHGOne</h2>
          <p>Hi {greeting},<br/>Your account has not been authorized to access NHGOne. If you believe this is a mistake, please contact your system administrator.</p>
          <p>สวัสดีคุณ {greeting},<br/>บัญชีของคุณไม่ได้รับอนุญาตให้เข้าใช้งานระบบ NHGOne หากคิดว่านี่เป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบ</p>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">Narai Hospitality Group — NHGOne</p>
        </div>
        """
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
