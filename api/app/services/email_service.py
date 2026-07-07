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

    def send_welcome_email(self, to_email: str, password: str, full_name: str = ""):
        greeting = full_name or to_email
        subject = "บัญชี NHGOne ของคุณถูกสร้างแล้ว / Your NHGOne account has been created"
        html_body = f"""
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #152A00;">
          <h2 style="color: #152A00;">NHGOne</h2>
          <p>สวัสดีคุณ {greeting},</p>
          <p>บัญชีของคุณถูกสร้างในระบบ NHGOne แล้ว ข้อมูลเข้าสู่ระบบมีดังนี้:</p>
          <p>Hi {greeting},<br/>Your NHGOne account has been created. Your login details are below:</p>
          <table style="margin: 16px 0;">
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">Email</td><td><b>{to_email}</b></td></tr>
            <tr><td style="padding: 4px 12px 4px 0; color: #666;">Password</td><td><b>{password}</b></td></tr>
          </table>
          <p>เข้าสู่ระบบผ่านหน้า Login แล้วเลือก "INTERNAL AUTH" เพื่อกรอกอีเมล/รหัสผ่านนี้ แนะนำให้เปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก</p>
          <p>Log in and select "INTERNAL AUTH" to enter this email/password. We recommend changing your password after your first login.</p>
          <p style="color: #999; font-size: 12px; margin-top: 24px;">Narai Hospitality Group — NHGOne</p>
        </div>
        """
        text_body = (
            f"Hi {greeting},\n\n"
            f"Your NHGOne account has been created.\n"
            f"Email: {to_email}\nPassword: {password}\n\n"
            f'Log in and select "INTERNAL AUTH" to enter this email/password. '
            f"We recommend changing your password after your first login.\n\nNarai Hospitality Group - NHGOne"
        )
        self.send_email(to_email, subject, html_body, text_body)


email_service = EmailService()
