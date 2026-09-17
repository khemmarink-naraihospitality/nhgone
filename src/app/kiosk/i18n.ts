/**
 * Guest-facing text for the light-theme flow (welcome/search/confirm/
 * registration), in the five languages a guest can pick from the top bar's
 * language selector: English, Thai, Filipino, Khmer, Japanese.
 *
 * These are prototype translations - phrased for clarity, not reviewed by a
 * native speaker of each language. Thai is reasonably solid; Khmer and
 * Japanese in particular should be checked before this is used with real
 * guests. Treat this file as a first draft to correct, not a finished
 * localization.
 *
 * `welcomeTitle`/`helloGreeting`/`noGuestsMatch` are functions rather than
 * plain strings specifically because Japanese: "Welcome to X" is "Xへようこそ"
 * (the name comes first, not last) - a fixed prefix-then-name concatenation
 * that works for English/Thai/Filipino/Khmer can't represent that word
 * order, so those three fields return the whole sentence instead of a
 * fragment for the caller to glue a name onto.
 *
 * `label` mirrors the exact strings Admin Console > Kiosks' Default language
 * dropdown stores (`property_api_settings`/`kiosk_settings.default_language`
 * via `LANGUAGES` in admin/kiosks/page.tsx), so `resolveDefaultLanguage` can
 * map a kiosk's configured default onto one of these five. `nativeLabel` is
 * what the picker itself shows - a guest looks for their own language's
 * name, not its English gloss.
 */

export type KioskLanguageCode = "en" | "th" | "fil" | "km" | "ja";

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
  { code: "ja", label: "Japanese (Japan)", nativeLabel: "日本語" },
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
  welcomeTitle: (propertyName: string) => string;
  checkIn: string;
  checkOut: string;
  searchPlaceholder: string;
  stay: string;
  noGuestsMatch: (query: string) => string;
  guestNotFound: string;
  helloGreeting: (guestName: string) => string;
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
  loading: string;
  loadError: string;
  notEnabled: string;
  noArrivals: string;
  unavailable: string;
}

const en: KioskCopy = {
  welcomeTitle: (name) => `Welcome to ${name}`,
  checkIn: "Check in",
  checkOut: "Check out",
  searchPlaceholder: "Search by name",
  stay: "Stay",
  noGuestsMatch: (query) => `No guests match "${query}".`,
  guestNotFound: "That guest wasn't found. Go back and pick one from the list.",
  helloGreeting: (name) => `Hello ${name},`,
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
  marketingOptInPrefix: "I'd like to occasionally receive marketing emails from ",
  marketingOptInSuffix: ".",
  signature: "Signature *",
  tapToSign: "Tap to sign",
  privacyFooter: {
    pre: "Read more about personal data processing in ",
    link: "Property Privacy Policy",
    post: ".",
  },
  loading: "Loading…",
  loadError: "We couldn't load reservations right now. Please ask the front desk for help.",
  notEnabled: "Self check-in isn't available at this property yet. Please visit the front desk.",
  noArrivals: "There are no more arrivals to check in today.",
  unavailable: "This booking can't be checked in here. Please visit the front desk.",
};

const th: KioskCopy = {
  welcomeTitle: (name) => `ยินดีต้อนรับสู่ ${name}`,
  checkIn: "เช็คอิน",
  checkOut: "เช็คเอาต์",
  searchPlaceholder: "ค้นหาด้วยชื่อ",
  stay: "การเข้าพัก",
  noGuestsMatch: (query) => `ไม่พบผู้เข้าพักที่ตรงกับ "${query}"`,
  guestNotFound: "ไม่พบผู้เข้าพักรายนี้ กรุณากลับไปเลือกจากรายชื่อ",
  helloGreeting: (name) => `สวัสดีคุณ ${name},`,
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
  marketingOptInPrefix: "ฉันต้องการรับอีเมลการตลาดเป็นครั้งคราวจาก ",
  marketingOptInSuffix: "",
  signature: "ลายเซ็น *",
  tapToSign: "แตะเพื่อเซ็นชื่อ",
  privacyFooter: {
    pre: "อ่านเพิ่มเติมเกี่ยวกับการประมวลผลข้อมูลส่วนบุคคลได้ที่ ",
    link: "นโยบายความเป็นส่วนตัวของโรงแรม",
    post: "",
  },
  loading: "กำลังโหลด…",
  loadError: "ไม่สามารถโหลดข้อมูลการจองได้ในขณะนี้ กรุณาติดต่อแผนกต้อนรับ",
  notEnabled: "โรงแรมนี้ยังไม่เปิดให้เช็คอินด้วยตนเอง กรุณาติดต่อแผนกต้อนรับ",
  noArrivals: "ไม่มีผู้เข้าพักที่รอเช็คอินสำหรับวันนี้แล้ว",
  unavailable: "การจองนี้ไม่สามารถเช็คอินที่เครื่องนี้ได้ กรุณาติดต่อแผนกต้อนรับ",
};

const fil: KioskCopy = {
  welcomeTitle: (name) => `Maligayang pagdating sa ${name}`,
  checkIn: "Mag-check in",
  checkOut: "Mag-check out",
  searchPlaceholder: "Maghanap gamit ang pangalan",
  stay: "Pananatili",
  noGuestsMatch: (query) => `Walang bisitang tumutugma sa "${query}".`,
  guestNotFound: "Hindi nahanap ang bisitang iyon. Bumalik at pumili mula sa listahan.",
  helloGreeting: (name) => `Kamusta ${name},`,
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
  marketingOptInPrefix: "Gusto kong paminsan-minsang tumanggap ng marketing email mula sa ",
  marketingOptInSuffix: ".",
  signature: "Lagda *",
  tapToSign: "Pindutin para pumirma",
  privacyFooter: {
    pre: "Magbasa pa tungkol sa pagproseso ng personal na datos sa ",
    link: "Patakaran sa Privacy ng Ari-arian",
    post: ".",
  },
  loading: "Naglo-load…",
  loadError: "Hindi namin ma-load ang mga reserbasyon ngayon. Mangyaring magtanong sa front desk.",
  notEnabled: "Ang self check-in ay hindi pa available sa property na ito. Mangyaring magtungo sa front desk.",
  noArrivals: "Wala nang bisitang kailangang mag-check in ngayong araw.",
  unavailable: "Hindi ma-check in dito ang booking na ito. Mangyaring magtungo sa front desk.",
};

const km: KioskCopy = {
  welcomeTitle: (name) => `សូមស្វាគមន៍មកកាន់ ${name}`,
  checkIn: "ចូលស្នាក់នៅ",
  checkOut: "ចាកចេញ",
  searchPlaceholder: "ស្វែងរកតាមឈ្មោះ",
  stay: "ការស្នាក់នៅ",
  noGuestsMatch: (query) => `រកមិនឃើញភ្ញៀវដែលត្រូវនឹង "${query}"។`,
  guestNotFound: "រកមិនឃើញភ្ញៀវនោះទេ។ សូមត្រឡប់ក្រោយ ហើយជ្រើសរើសម្នាក់ពីបញ្ជី។",
  helloGreeting: (name) => `សួស្តី ${name},`,
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
  marketingOptInPrefix: "ខ្ញុំចង់ទទួលអ៊ីមែលទីផ្សារម្តងម្កាលពី ",
  marketingOptInSuffix: "។",
  signature: "ហត្ថលេខា *",
  tapToSign: "ចុចដើម្បីចុះហត្ថលេខា",
  privacyFooter: {
    pre: "អានបន្ថែមអំពីការដំណើរការទិន្នន័យផ្ទាល់ខ្លួននៅក្នុង ",
    link: "គោលការណ៍ឯកជនភាពរបស់អចលនទ្រព្យ",
    post: "។",
  },
  loading: "កំពុងផ្ទុក…",
  loadError: "មិនអាចផ្ទុកការកក់បានទេនៅពេលនេះ។ សូមទាក់ទងផ្នែកទទួលភ្ញៀវ។",
  notEnabled: "ការចូលស្នាក់នៅដោយខ្លួនឯងមិនទាន់មាននៅទីនេះនៅឡើយទេ។ សូមទៅកាន់ផ្នែកទទួលភ្ញៀវ។",
  noArrivals: "មិនមានភ្ញៀវដែលត្រូវចូលស្នាក់នៅថ្ងៃនេះទៀតទេ។",
  unavailable: "ការកក់នេះមិនអាចចូលស្នាក់នៅនៅទីនេះបានទេ។ សូមទៅកាន់ផ្នែកទទួលភ្ញៀវ។",
};

const ja: KioskCopy = {
  welcomeTitle: (name) => `${name}へようこそ`,
  checkIn: "チェックイン",
  checkOut: "チェックアウト",
  searchPlaceholder: "名前で検索",
  stay: "宿泊",
  noGuestsMatch: (query) => `「${query}」に一致するゲストが見つかりません。`,
  guestNotFound: "そのゲストが見つかりませんでした。戻ってリストから選び直してください。",
  helloGreeting: (name) => `${name}様、こんにちは。`,
  confirmSubtitle: "内容をご確認ください。",
  yourBooking: "ご予約内容",
  checkOutLabel: "チェックアウト",
  confirmButton: "確認する",
  reservationOwner: "予約者",
  progress: "進捗状況",
  tapToReturnSkipped: "スキップしたゲストに戻る場合はタップしてください",
  next: "次へ",
  enterYourDetails: "お客様情報を入力してください",
  email: "メールアドレス",
  agreeTerms: { pre: "", link: "施設の利用規約", post: "に同意します。*" },
  marketingOptInPrefix: "",
  marketingOptInSuffix: "からのマーケティングメールを時々受け取りたいです。",
  signature: "署名 *",
  tapToSign: "タップして署名",
  privacyFooter: {
    pre: "個人情報の取り扱いについて詳しくは",
    link: "施設のプライバシーポリシー",
    post: "をご覧ください。",
  },
  loading: "読み込み中…",
  loadError: "現在、予約情報を読み込めません。フロントデスクにお声がけください。",
  notEnabled: "この施設ではセルフチェックインをまだご利用いただけません。フロントデスクへお越しください。",
  noArrivals: "本日チェックイン予定のお客様は以上です。",
  unavailable: "このご予約はこちらではチェックインできません。フロントデスクへお越しください。",
};

export const KIOSK_COPY: Record<KioskLanguageCode, KioskCopy> = { en, th, fil, km, ja };
