import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_supabase_client
from app.services.encryption import encryption_service

logger = logging.getLogger(__name__)


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

        with smtplib.SMTP(cfg["host"], int(cfg["port"]), timeout=15) as server:
            if cfg.get("use_tls", True):
                server.starttls()
            if cfg.get("username"):
                server.login(cfg["username"], cfg["password"])
            server.sendmail(cfg["from_email"], [to_email], msg.as_string())

    def send_welcome_email(self, to_email: str, password: str | None, full_name: str = ""):
        greeting = full_name or to_email
        subject = "บัญชี NHGOne ของคุณถูกสร้างแล้ว / Your NHGOne account has been created"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #152A00;">
          <h2 style="color: #152A00;">NHGOne</h2>
          <p>สวัสดีคุณ {greeting},</p>
          <p>บัญชีของคุณถูกสร้างในระบบ NHGOne แล้ว</p>
          <p>Hi {greeting},<br/>Your NHGOne account has been created and is ready to use.</p>
          <div style="margin: 24px 0; padding: 16px; background: #f9f9f9; border-left: 3px solid #AAA024;">
            <p style="margin: 0; color: #666; font-size: 13px;">ลงชื่อเข้าใช้ที่ / Sign in at:</p>
            <p style="margin: 4px 0 0; font-weight: bold;">nhgone.vercel.app</p>
            <p style="margin: 8px 0 0; color: #444; font-size: 13px;">ใช้ <b>Continue with Google</b> ด้วยบัญชี Google ที่ลงทะเบียนนี้: <b>{to_email}</b></p>
            <p style="margin: 4px 0 0; color: #444; font-size: 13px;">Use <b>Continue with Google</b> with the Google account for: <b>{to_email}</b></p>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">Narai Hospitality Group — NHGOne</p>
        </div>
        """
        text_body = (
            f"Hi {greeting},\n\n"
            f"Your NHGOne account has been created.\n\n"
            f"Sign in at nhgone.vercel.app using 'Continue with Google' "
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
