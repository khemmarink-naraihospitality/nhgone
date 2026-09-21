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
  included: string;
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
  showAll: string;
  /** Badge per MEWS reservation State, shown only while "Show all" is on
   * and only on the cards that aren't Confirmed. */
  stateLabel: Record<string, string>;
  guests: string;
  addGuest: string;
  firstName: string;
  lastName: string;
  save: string;
  cancel: string;
  remove: string;
  signed: string;
  clearSignature: string;
  saveFailed: string;
  // The reservation loaded but signatures can't be saved here yet - the
  // registration storage hasn't been set up. Says so instead of blaming
  // the reservation, which is what the generic loadError used to do.
  signingUnavailable: string;
  // Added-guest profile form (MEWS's own Add guest fields)
  adult: string;
  complete: string;
  /** "Guest 2" - numbered by position in the whole list, owner being 1. */
  guestN: (n: number) => string;
  selectGuest: string;
  nationality: string;
  telephone: string;
  occupation: string;
  personalAddress: string;
  useAddress: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  country: string;
  identityDocument: string;
  documentType: string;
  passport: string;
  identityCard: string;
  driversLicense: string;
  documentNumber: string;
  issueDate: string;
  issuingCountry: string;
  issuingCity: string;
  expirationDate: string;
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
  included: "Included",
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
  showAll: "Show all reservations",
  stateLabel: {
    Confirmed: "Awaiting check-in",
    Started: "Checked in",
    Processed: "Checked out",
    Canceled: "Canceled",
    Optional: "Optional",
    Inquired: "Inquiry",
  },
  guests: "Guests",
  addGuest: "Add guest",
  firstName: "Given names",
  lastName: "Last name",
  save: "Save",
  cancel: "Cancel",
  remove: "Remove",
  signed: "Signed",
  clearSignature: "Clear",
  saveFailed: "We couldn't save that. Please ask the front desk for help.",
  signingUnavailable: "Signing isn't available at this terminal yet. Please ask the front desk to check you in.",
  adult: "Adult",
  complete: "Complete",
  guestN: (n) => `Guest ${n}`,
  selectGuest: "Select guest",
  nationality: "Nationality",
  telephone: "Telephone",
  occupation: "Occupation",
  personalAddress: "Personal address",
  useAddress: "Use address",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "City",
  postalCode: "Postal code",
  country: "Country",
  identityDocument: "Identity document",
  documentType: "Type",
  passport: "Passport",
  identityCard: "Identity card",
  driversLicense: "Driver's license",
  documentNumber: "Number",
  issueDate: "Issue date",
  issuingCountry: "Issuing country",
  issuingCity: "Issuing city",
  expirationDate: "Expiration date",
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
  included: "รวมอยู่ในราคา",
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
  showAll: "แสดงการจองทั้งหมด",
  stateLabel: {
    Confirmed: "รอเช็คอิน",
    Started: "เช็คอินแล้ว",
    Processed: "เช็คเอาต์แล้ว",
    Canceled: "ยกเลิก",
    Optional: "จองชั่วคราว",
    Inquired: "สอบถาม",
  },
  guests: "ผู้เข้าพัก",
  addGuest: "เพิ่มผู้เข้าพัก",
  firstName: "ชื่อ",
  lastName: "นามสกุล",
  save: "บันทึก",
  cancel: "ยกเลิก",
  remove: "ลบออก",
  signed: "เซ็นแล้ว",
  clearSignature: "ล้าง",
  saveFailed: "บันทึกไม่สำเร็จ กรุณาติดต่อแผนกต้อนรับ",
  signingUnavailable: "เครื่องนี้ยังไม่พร้อมให้เซ็นชื่อ กรุณาติดต่อแผนกต้อนรับเพื่อเช็คอิน",
  adult: "ผู้ใหญ่",
  complete: "เสร็จสมบูรณ์",
  guestN: (n) => `ผู้เข้าพักคนที่ ${n}`,
  selectGuest: "เลือกผู้เข้าพัก",
  nationality: "สัญชาติ",
  telephone: "โทรศัพท์",
  occupation: "อาชีพ",
  personalAddress: "ที่อยู่",
  useAddress: "ใช้ที่อยู่นี้",
  addressLine1: "ที่อยู่ บรรทัดที่ 1",
  addressLine2: "ที่อยู่ บรรทัดที่ 2",
  city: "เมือง / จังหวัด",
  postalCode: "รหัสไปรษณีย์",
  country: "ประเทศ",
  identityDocument: "เอกสารระบุตัวตน",
  documentType: "ประเภท",
  passport: "หนังสือเดินทาง",
  identityCard: "บัตรประจำตัวประชาชน",
  driversLicense: "ใบขับขี่",
  documentNumber: "เลขที่",
  issueDate: "วันที่ออก",
  issuingCountry: "ประเทศที่ออก",
  issuingCity: "เมืองที่ออก",
  expirationDate: "วันหมดอายุ",
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
  included: "Kasama na",
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
  showAll: "Ipakita lahat ng reserbasyon",
  stateLabel: {
    Confirmed: "Naghihintay ng check-in",
    Started: "Naka-check in na",
    Processed: "Naka-check out na",
    Canceled: "Kinansela",
    Optional: "Pansamantala",
    Inquired: "Pagtatanong",
  },
  guests: "Mga bisita",
  addGuest: "Magdagdag ng bisita",
  firstName: "Mga pangalan",
  lastName: "Apelyido",
  save: "I-save",
  cancel: "Kanselahin",
  remove: "Alisin",
  signed: "Nakapirma na",
  clearSignature: "Burahin",
  saveFailed: "Hindi ma-save iyon. Mangyaring magtanong sa front desk.",
  signingUnavailable: "Hindi pa available ang pagpirma sa terminal na ito. Mangyaring magtanong sa front desk para mag-check in.",
  adult: "Adulto",
  complete: "Kumpleto",
  guestN: (n) => `Bisita ${n}`,
  selectGuest: "Piliin ang bisita",
  nationality: "Nasyonalidad",
  telephone: "Telepono",
  occupation: "Trabaho",
  personalAddress: "Personal na address",
  useAddress: "Gamitin ang address",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "Lungsod",
  postalCode: "Postal code",
  country: "Bansa",
  identityDocument: "Dokumento ng pagkakakilanlan",
  documentType: "Uri",
  passport: "Pasaporte",
  identityCard: "ID card",
  driversLicense: "Lisensya sa pagmamaneho",
  documentNumber: "Numero",
  issueDate: "Petsa ng pagkakaloob",
  issuingCountry: "Bansang nagbigay",
  issuingCity: "Lungsod na nagbigay",
  expirationDate: "Petsa ng pagkawalang-bisa",
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
  included: "រួមបញ្ចូល",
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
  showAll: "បង្ហាញការកក់ទាំងអស់",
  stateLabel: {
    Confirmed: "កំពុងរង់ចាំចូលស្នាក់នៅ",
    Started: "បានចូលស្នាក់នៅ",
    Processed: "បានចាកចេញ",
    Canceled: "បានលុបចោល",
    Optional: "បណ្ដោះអាសន្ន",
    Inquired: "ការសាកសួរ",
  },
  guests: "ភ្ញៀវ",
  addGuest: "បន្ថែមភ្ញៀវ",
  firstName: "នាម",
  lastName: "នាមត្រកូល",
  save: "រក្សាទុក",
  cancel: "បោះបង់",
  remove: "លុបចេញ",
  signed: "បានចុះហត្ថលេខា",
  clearSignature: "សម្អាត",
  saveFailed: "មិនអាចរក្សាទុកបានទេ។ សូមទាក់ទងផ្នែកទទួលភ្ញៀវ។",
  signingUnavailable: "ម៉ាស៊ីននេះមិនទាន់អាចចុះហត្ថលេខាបានទេ។ សូមទាក់ទងផ្នែកទទួលភ្ញៀវដើម្បីចុះឈ្មោះចូលស្នាក់នៅ។",
  adult: "មនុស្សពេញវ័យ",
  complete: "បានបញ្ចប់",
  guestN: (n) => `ភ្ញៀវទី ${n}`,
  selectGuest: "ជ្រើសរើសភ្ញៀវ",
  nationality: "សញ្ជាតិ",
  telephone: "ទូរសព្ទ",
  occupation: "មុខរបរ",
  personalAddress: "អាសយដ្ឋាន",
  useAddress: "ប្រើអាសយដ្ឋាននេះ",
  addressLine1: "អាសយដ្ឋាន បន្ទាត់ទី 1",
  addressLine2: "អាសយដ្ឋាន បន្ទាត់ទី 2",
  city: "ទីក្រុង",
  postalCode: "លេខកូដប្រៃសណីយ៍",
  country: "ប្រទេស",
  identityDocument: "ឯកសារអត្តសញ្ញាណ",
  documentType: "ប្រភេទ",
  passport: "លិខិតឆ្លងដែន",
  identityCard: "អត្តសញ្ញាណប័ណ្ណ",
  driversLicense: "ប័ណ្ណបើកបរ",
  documentNumber: "លេខ",
  issueDate: "ថ្ងៃចេញ",
  issuingCountry: "ប្រទេសចេញ",
  issuingCity: "ទីក្រុងចេញ",
  expirationDate: "ថ្ងៃផុតកំណត់",
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
  included: "含まれるもの",
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
  showAll: "すべての予約を表示",
  stateLabel: {
    Confirmed: "チェックイン待ち",
    Started: "チェックイン済み",
    Processed: "チェックアウト済み",
    Canceled: "キャンセル",
    Optional: "仮予約",
    Inquired: "問い合わせ",
  },
  guests: "ご宿泊者",
  addGuest: "宿泊者を追加",
  firstName: "名",
  lastName: "姓",
  save: "保存",
  cancel: "キャンセル",
  remove: "削除",
  signed: "署名済み",
  clearSignature: "消去",
  saveFailed: "保存できませんでした。フロントデスクにお声がけください。",
  signingUnavailable: "この端末ではまだ署名できません。チェックインはフロントデスクにお声がけください。",
  adult: "大人",
  complete: "完了",
  guestN: (n) => `ゲスト${n}`,
  selectGuest: "ゲストを選択",
  nationality: "国籍",
  telephone: "電話番号",
  occupation: "職業",
  personalAddress: "住所",
  useAddress: "この住所を使う",
  addressLine1: "住所1",
  addressLine2: "住所2",
  city: "市区町村",
  postalCode: "郵便番号",
  country: "国",
  identityDocument: "身分証明書",
  documentType: "種類",
  passport: "パスポート",
  identityCard: "身分証明書カード",
  driversLicense: "運転免許証",
  documentNumber: "番号",
  issueDate: "発行日",
  issuingCountry: "発行国",
  issuingCity: "発行都市",
  expirationDate: "有効期限",
};

export const KIOSK_COPY: Record<KioskLanguageCode, KioskCopy> = { en, th, fil, km, ja };
