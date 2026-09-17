/**
 * Guest-facing text for the light-theme flow (welcome/search/confirm/
 * registration), in the four languages a guest can pick from the top bar's
 * language selector: English, Thai, Filipino, Khmer.
 *
 * These are prototype translations - phrased for clarity, not reviewed by a
 * native speaker of each language. Thai is reasonably solid; Khmer in
 * particular should be checked before this is used with real guests. Treat
 * this file as a first draft to correct, not a finished localization.
 *
 * `label` mirrors the exact strings Admin Console > Kiosks' Default language
 * dropdown stores (`property_api_settings`/`kiosk_settings.default_language`
 * via `LANGUAGES` in admin/kiosks/page.tsx), so `resolveDefaultLanguage` can
 * map a kiosk's configured default onto one of these four. `nativeLabel` is
 * what the picker itself shows - a guest looks for their own language's
 * name, not its English gloss.
 */

export type KioskLanguageCode = "en" | "th" | "fil" | "km";

export interface KioskLanguageOption {
  code: KioskLanguageCode;
  label: string;
  nativeLabel: string;
}

export const KIOSK_LANGUAGES: KioskLanguageOption[] = [
  { code: "en", label: "English (United States)", nativeLabel: "English" },
  { code: "th", label: "Thai (Thailand)", nativeLabel: "ไทย" },
  { code: "fil", label: "Filipino (Philippines)", nativeLabel: "Filipino" },
  { code: "km", label: "Khmer (Cambodia)", nativeLabel: "ខ្មែរ" },
];

export function resolveDefaultLanguage(
  configuredLabel: string | null | undefined
): KioskLanguageCode {
  const name = (configuredLabel || "").toLowerCase();
  const match = KIOSK_LANGUAGES.find((l) => name.startsWith(l.label.split(" ")[0].toLowerCase()));
  return match?.code || "en";
}

export interface KioskLinkText {
  pre: string;
  link: string;
  post: string;
}

export interface KioskCopy {
  welcomeTitle: string;
  checkIn: string;
  checkOut: string;
  searchPlaceholder: string;
  stay: string;
  noGuestsMatch: string;
  guestNotFound: string;
  helloPrefix: string;
  confirmSubtitle: string;
  yourBooking: string;
  checkOutLabel: string;
  confirmButton: string;
  reservationOwner: string;
  progress: string;
  tapToReturnSkipped: string;
  next: string;
  enterYourDetails: string;
  email: string;
  agreeTerms: KioskLinkText;
  marketingOptInPrefix: string;
  marketingOptInSuffix: string;
  signature: string;
  tapToSign: string;
  privacyFooter: KioskLinkText;
}

const en: KioskCopy = {
  welcomeTitle: "Welcome to",
  checkIn: "Check in",
  checkOut: "Check out",
  searchPlaceholder: "Search by name",
  stay: "Stay",
  noGuestsMatch: "No guests match",
  guestNotFound: "That guest wasn't found. Go back and pick one from the list.",
  helloPrefix: "Hello",
  confirmSubtitle: "Let's confirm your details.",
  yourBooking: "Your booking",
  checkOutLabel: "Check-out",
  confirmButton: "Confirm",
  reservationOwner: "Reservation owner",
  progress: "Progress",
  tapToReturnSkipped: "Tap to return skipped guest",
  next: "Next",
  enterYourDetails: "Enter your details",
  email: "Email",
  agreeTerms: { pre: "I agree with ", link: "Property Terms and Conditions", post: ". *" },
  marketingOptInPrefix: "I'd like to occasionally receive marketing emails from",
  marketingOptInSuffix: ".",
  signature: "Signature *",
  tapToSign: "Tap to sign",
  privacyFooter: {
    pre: "Read more about personal data processing in ",
    link: "Property Privacy Policy",
    post: ".",
  },
};

const th: KioskCopy = {
  welcomeTitle: "ยินดีต้อนรับสู่",
  checkIn: "เช็คอิน",
  checkOut: "เช็คเอาต์",
  searchPlaceholder: "ค้นหาด้วยชื่อ",
  stay: "การเข้าพัก",
  noGuestsMatch: "ไม่พบผู้เข้าพักที่ตรงกับ",
  guestNotFound: "ไม่พบผู้เข้าพักรายนี้ กรุณากลับไปเลือกจากรายชื่อ",
  helloPrefix: "สวัสดีคุณ",
  confirmSubtitle: "กรุณายืนยันข้อมูลของท่าน",
  yourBooking: "การจองของท่าน",
  checkOutLabel: "เช็คเอาต์",
  confirmButton: "ยืนยัน",
  reservationOwner: "ผู้จอง",
  progress: "ความคืบหน้า",
  tapToReturnSkipped: "แตะเพื่อกลับไปยังผู้เข้าพักที่ข้ามไป",
  next: "ถัดไป",
  enterYourDetails: "กรอกข้อมูลของท่าน",
  email: "อีเมล",
  agreeTerms: { pre: "ฉันยอมรับ", link: "ข้อกำหนดและเงื่อนไขของโรงแรม", post: " *" },
  marketingOptInPrefix: "ฉันต้องการรับอีเมลการตลาดเป็นครั้งคราวจาก",
  marketingOptInSuffix: "",
  signature: "ลายเซ็น *",
  tapToSign: "แตะเพื่อเซ็นชื่อ",
  privacyFooter: {
    pre: "อ่านเพิ่มเติมเกี่ยวกับการประมวลผลข้อมูลส่วนบุคคลได้ที่ ",
    link: "นโยบายความเป็นส่วนตัวของโรงแรม",
    post: "",
  },
};

const fil: KioskCopy = {
  welcomeTitle: "Maligayang pagdating sa",
  checkIn: "Mag-check in",
  checkOut: "Mag-check out",
  searchPlaceholder: "Maghanap gamit ang pangalan",
  stay: "Pananatili",
  noGuestsMatch: "Walang bisitang tumutugma sa",
  guestNotFound: "Hindi nahanap ang bisitang iyon. Bumalik at pumili mula sa listahan.",
  helloPrefix: "Kamusta",
  confirmSubtitle: "Kumpirmahin natin ang iyong mga detalye.",
  yourBooking: "Ang iyong booking",
  checkOutLabel: "Check-out",
  confirmButton: "Kumpirmahin",
  reservationOwner: "May-ari ng reserbasyon",
  progress: "Pag-unlad",
  tapToReturnSkipped: "Pindutin para bumalik sa nilaktawang bisita",
  next: "Susunod",
  enterYourDetails: "Ilagay ang iyong mga detalye",
  email: "Email",
  agreeTerms: { pre: "Sumasang-ayon ako sa ", link: "Mga Tuntunin at Kundisyon ng Ari-arian", post: ". *" },
  marketingOptInPrefix: "Gusto kong paminsan-minsang tumanggap ng marketing email mula sa",
  marketingOptInSuffix: ".",
  signature: "Lagda *",
  tapToSign: "Pindutin para pumirma",
  privacyFooter: {
    pre: "Magbasa pa tungkol sa pagproseso ng personal na datos sa ",
    link: "Patakaran sa Privacy ng Ari-arian",
    post: ".",
  },
};

const km: KioskCopy = {
  welcomeTitle: "សូមស្វាគមន៍មកកាន់",
  checkIn: "ចូលស្នាក់នៅ",
  checkOut: "ចាកចេញ",
  searchPlaceholder: "ស្វែងរកតាមឈ្មោះ",
  stay: "ការស្នាក់នៅ",
  noGuestsMatch: "រកមិនឃើញភ្ញៀវដែលត្រូវនឹង",
  guestNotFound: "រកមិនឃើញភ្ញៀវនោះទេ។ សូមត្រឡប់ក្រោយ ហើយជ្រើសរើសម្នាក់ពីបញ្ជី។",
  helloPrefix: "សួស្តី",
  confirmSubtitle: "តោះបញ្ជាក់ព័ត៌មានលម្អិតរបស់អ្នក។",
  yourBooking: "ការកក់របស់អ្នក",
  checkOutLabel: "ចាកចេញ",
  confirmButton: "បញ្ជាក់",
  reservationOwner: "ម្ចាស់ការកក់",
  progress: "វឌ្ឍនភាព",
  tapToReturnSkipped: "ចុចដើម្បីត្រឡប់ទៅភ្ញៀវដែលរំលង",
  next: "បន្ទាប់",
  enterYourDetails: "បញ្ចូលព័ត៌មានលម្អិតរបស់អ្នក",
  email: "អ៊ីមែល",
  agreeTerms: { pre: "ខ្ញុំយល់ព្រមតាម ", link: "លក្ខខណ្ឌរបស់អចលនទ្រព្យ", post: "។ *" },
  marketingOptInPrefix: "ខ្ញុំចង់ទទួលអ៊ីមែលទីផ្សារម្តងម្កាលពី",
  marketingOptInSuffix: "។",
  signature: "ហត្ថលេខា *",
  tapToSign: "ចុចដើម្បីចុះហត្ថលេខា",
  privacyFooter: {
    pre: "អានបន្ថែមអំពីការដំណើរការទិន្នន័យផ្ទាល់ខ្លួននៅក្នុង ",
    link: "គោលការណ៍ឯកជនភាពរបស់អចលនទ្រព្យ",
    post: "។",
  },
};

export const KIOSK_COPY: Record<KioskLanguageCode, KioskCopy> = { en, th, fil, km };
