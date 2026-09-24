/**
 * OSH Checklist - built-in defaults, copied VERBATIM from the prototype this
 * module was ported from (the React app shared as a Gemini Canvas, source in
 * a Google Doc). They are what every page falls back to for a setting nobody
 * has saved yet - exactly the prototype's own "localStorage empty -> use the
 * default" behaviour, with Supabase (osh_settings) in place of localStorage.
 *
 * The 136 checklist items and 6 categories were extracted from the source by
 * script rather than retyped, so they match it character for character.
 *
 * One deliberate difference: DEFAULT_PROPERTIES spells Makati the way the
 * rest of NHGOne does ("Lub d Philippines Makati", the MEWS property name)
 * rather than the prototype's "Lub d Manila Makati", so a role restricted to
 * that property (role_permissions.restricted_properties) still finds it here.
 */

export interface OshCategory {
  id: string;
  name: string;
}

export interface OshChecklistItem {
  id: number;
  code: string;
  catId: string;
  desc: string;
}

export interface OshFormItem extends OshChecklistItem {
  status: string;
  subStatus: string;
  actionPlan: string;
  /** Public URL in the osh-photos bucket (the prototype held a base64 data
   * URL here). null when no photo is attached. */
  photo: string | null;
}

export interface OshHeader {
  propertyName: string;
  date: string;
  year: string;
  period: string;
  operatorName: string;
}

export interface OshEmailConfig {
  subject: string;
  body: string;
  recipients: string;
}

export type OshEmailSettings = Record<string, OshEmailConfig>;

export interface OshReport {
  id: string;
  property_name: string;
  header: OshHeader;
  items: OshFormItem[];
  score: number;
  submitted_at: string;
  submitted_by: string | null;
  email_status: string | null;
  email_detail: string | null;
}

export const STATUS_OPTS = ["Compliant", "Observation", "Non-compliant", "N/A"];
export const SUB_STATUS_OPTS = ["Done", "Working on it", "Not Started", "Hold", "N/A"];

export const emptyHeader = (): OshHeader => ({
  propertyName: "",
  date: "",
  year: new Date().getFullYear().toString(),
  period: "Mid Year",
  operatorName: "",
});

export const DEFAULT_CATEGORIES: OshCategory[] = [
  { id: 'A', name: 'หมวดหมู่ A: Facility & Infrastructure Safety / ความปลอดภัยอาคารและโครงสร้างพื้นฐาน' },
  { id: 'B', name: 'หมวดหมู่ B: Operational Safety / ความปลอดภัยในการปฏิบัติงาน' },
  { id: 'C', name: 'หมวดหมู่ C: Occupational Health & Worker Welfare / อาชีวอนามัยและสวัสดิการพนักงาน' },
  { id: 'D', name: 'หมวดหมู่ D: Emergency Preparedness / การเตรียมพร้อมภาวะฉุกเฉิน' },
  { id: 'E', name: 'หมวดหมู่ E: Government Compliance / การปฏิบัติตามกฎหมายและข้อกำหนดภาครัฐ' },
  { id: 'F', name: 'หมวดหมู่ F: OSH Mandatory Training / การฝึกอบรมตามกฎหมายความปลอดภัย' }
];

export const DEFAULT_CHECKLIST: OshChecklistItem[] = [
  { id: 1, code: 'A001', catId: 'A', desc: 'มีแผนผังทางหนีไฟ (Evacuation Plan) ติดตั้งแสดงตำแหน่งชัดเจนในทุกชั้นและทุกห้องพัก / Evacuation plans are clearly displayed showing current location on every floor and in all guest rooms.' },
  { id: 2, code: 'A002', catId: 'A', desc: 'ป้ายบอกทางหนีไฟ (Exit Signs) มีแสงสว่างชัดเจน มีระบบไฟสำรอง และทำงานตลอด 24 ชม. / Illuminated Exit signs with battery backup operating 24/7.' },
  { id: 3, code: 'A003', catId: 'A', desc: 'ประตูหนีไฟ (Fire Exit Door) เปิดออกสู่ภายนอกได้ง่าย ไม่ถูกล็อคจากข้างใน และเปิดได้ตลอดเวลา / Fire exit doors open outward easily, are never locked from the inside, and remain accessible at all times.' },
  { id: 4, code: 'A004', catId: 'A', desc: 'เส้นทางหนีไฟ ทางเดิน และบันไดหนีไฟ ไม่มีสิ่งของ วัตถุ หรือสิ่งกีดขวางใดๆ / Fire exit routes, corridors, and emergency stairwells are free of any objects or obstructions.' },
  { id: 5, code: 'A005', catId: 'A', desc: 'บันไดหนีไฟมีราวจับที่มั่นคงแข็งแรง มีไฟส่องสว่างเพียงพอ และไม่มีวัสดุติดไฟสะสม / Emergency stairwells have sturdy handrails, adequate lighting, and no accumulation of combustible materials.' },
  { id: 6, code: 'A006', catId: 'A', desc: 'ประตูกันไฟ (Fire Door) มีระบบคุมการปิดอัตโนมัติ (Door Closer) และปิดได้สนิท / Fire doors are equipped with operational automatic door closers and seal completely when closed.' },
  { id: 7, code: 'A007', catId: 'A', desc: 'ระบบสัญญาณแจ้งเหตุเพลิงไหม้ (Fire Alarm System / Manual Call Point) อยู่ในสภาพพร้อมใช้งาน / The fire alarm system and manual call points are in fully functional condition and ready for use.' },
  { id: 8, code: 'A008', catId: 'A', desc: 'ตู้ควบคุมระบบแจ้งเหตุเพลิงไหม้ (Fire Alarm Control Panel - FACP) ขึ้นสถานะ Normal ไม่มี Fault / The Fire Alarm Control Panel (FACP) displays \'Normal\' status with no fault indicators.' },
  { id: 9, code: 'A009', catId: 'A', desc: 'หัวตรวจจับควันและแรงร้อน (Smoke & Heat Detectors) ไม่มีสิ่งปกคลุม สะอาด และได้รับการตรวจสอบ / Smoke and heat detectors are uncovered, clean, and regularly inspected and tested.' },
  { id: 10, code: 'A010', catId: 'A', desc: 'ถังดับเพลิงยกหิ้ว (Fire Extinguisher) มีเกจวัดแรงดันอยู่ในเกณฑ์ปกติ (แถบสีเขียว) และมีซีลล็อคสมบูรณ์ / Portable fire extinguishers have pressure gauges in the green zone with intact safety seals.' },
  { id: 11, code: 'A011', catId: 'A', desc: 'ถังดับเพลิงได้รับการติดตั้งสูงจากพื้นไม่เกิน 1.5 เมตร และมีป้ายชี้บอกตำแหน่งชัดเจน / Fire extinguishers are mounted no higher than 1.5 meters from the floor with clear directional signage.' },
  { id: 12, code: 'A012', catId: 'A', desc: 'ถังดับเพลิงมีชนิดและขนาดเหมาะสมกับประเภทของเชื้อเพลิงในพื้นที่ (A, B, C, D, K) / Fire extinguishers are of appropriate types and sizes for the specific fire hazards in the area (A, B, C, D, K).' },
  { id: 13, code: 'A013', catId: 'A', desc: 'สายฉีดน้ำดับเพลิง (Hose Reel / Hose Rack) และหัวฉีดอยู่ในสภาพดี ไม่รั่วซึม หรือชำรุด / Fire hose reels, hose racks, and nozzles are in good condition without leaks or damages.' },
  { id: 14, code: 'A014', catId: 'A', desc: 'ตู้ดับเพลิงอาคาร (Fire Hose Cabinet) มีสิ่งของวางบังหรือไม่ถูกล็อคเปิดยาก / Fire hose cabinets are unobstructed, easily accessible, and not locked shut.' },
  { id: 15, code: 'A015', catId: 'A', desc: 'ระบบสปริงเกลอร์ (Fire Sprinkler) มีระยะห่างจากสิ่งกีดขวางใต้หัวสปริงเกลอร์อย่างน้อย 50 ซม. / Fire sprinklers maintain a clearance of at least 50 cm from any obstructions below the sprinkler heads.' },
  { id: 16, code: 'A016', catId: 'A', desc: 'วาล์วควบคุมระบบดับเพลิง (Control Valves) เปิดอยู่ในตำแหน่งปกติและมีการล็อคป้องกันการหมุน / Fire protection control valves are locked in their normal open positions to prevent unauthorized tampering.' },
  { id: 17, code: 'A017', catId: 'A', desc: 'ปั๊มน้ำดับเพลิง (Fire Pump) มีการทดสอบการทำงานประจำสัปดาห์/เดือน และมีน้ำในถังสำรองเพียงพอ / Fire pumps undergo weekly/monthly operational tests, and water storage tanks maintain adequate capacity.' },
  { id: 18, code: 'A018', catId: 'A', desc: 'มีระบบไฟฉุกเฉิน (Emergency Light) ติดตั้งครอบคลุม และส่องสว่างต่อเนื่องอย่างน้อย 2 ชม. / Emergency lighting is comprehensively installed and capable of providing continuous illumination for at least 2 hours.' },
  { id: 19, code: 'A019', catId: 'A', desc: 'พื้นผิวทางเดินในพื้นที่สาธารณะ ล็อบบี้ และโถงทางเดิน ไม่ลื่น แห้ง สะอาด ไม่มีรอยแตกร้าว / Walkway surfaces in public areas, lobby, and corridors are dry, clean, non-slip, and free of cracks.' },
  { id: 20, code: 'A020', catId: 'A', desc: 'มีการวางป้ายเตือนพื้นลื่น (Wet Floor Sign) ขณะมีการทำความสะอาดหรือพื้นเปียก / \'Wet Floor\' warning signs are deployed during cleaning operations or whenever floors are wet.' },
  { id: 21, code: 'A021', catId: 'A', desc: 'บันไดสาธารณะมีคันเคาะกันลื่น (Nosing Edge) และราวจับที่มั่นคงสองข้าง / Public stairways are fitted with anti-slip nosing edges and sturdy handrails on both sides.' },
  { id: 22, code: 'A022', catId: 'A', desc: 'กระจกใส ผนังกระจก ประตูบานเลื่อน มีสติ๊กเกอร์สัญลักษณ์เตือนในระดับสายตา / Transparent glass doors, glass walls, and sliding doors have warning safety decals affixed at eye level.' },
  { id: 23, code: 'A023', catId: 'A', desc: 'ราวกั้นระเบียง ราวกันตก (Balcony Railings) สูงไม่น้อยกว่า 1.1 เมตร และมีความแข็งแรงไม่โยกคลอน / Balcony railings and guardrails are at least 1.1 meters high, structurally sound, and non-wobbly.' },
  { id: 24, code: 'A024', catId: 'A', desc: 'เพดาน โคมไฟ และอุปกรณ์แขวนลอยในพื้นที่สาธารณะมีการยึดแน่น ไม่เสี่ยงต่อการหล่นร่วง / Ceilings, light fixtures, and suspended items in public areas are securely anchored with no fall hazards.' },
  { id: 25, code: 'A025', catId: 'A', desc: 'ลิฟต์โดยสารมีใบอนุญาตใช้งาน (บ.ภ.11) ติดตั้ง และผ่านการตรวจเช็คระบบความปลอดภัยประจำเดือน / Passenger elevators hold valid operating permits (B.P. 11) and pass monthly safety inspections.' },
  { id: 26, code: 'A026', catId: 'A', desc: 'ปุ่มกดฉุกเฉิน และโทรศัพท์สื่อสารภายในลิฟต์สามารถติดต่อเจ้าหน้าที่ได้ตลอด 24 ชม. / Elevator emergency alarm buttons and intercoms are fully functional and connect to staff 24/7.' },
  { id: 27, code: 'A027', catId: 'A', desc: 'ทางลาดสำหรับผู้พิการและรถเข็นมีความชันตามเกณฑ์ มีราวจับ และไม่ลื่น / Wheelchair ramps comply with standard slope regulations, feature handrails, and have non-slip surfaces.' },
  { id: 28, code: 'A028', catId: 'A', desc: 'บริเวณพื้นที่ก่อสร้างหรือซ่อมแซม มีกั้นเขต พร้อมป้ายเตือนอันตรายชัดเจน / Construction and renovation areas are barricaded with clear hazard warning signs posted.' },
  { id: 29, code: 'A029', catId: 'A', desc: 'ห้องเครื่องจักร (Engineering Room / M&E) สะอาด มีระเบียบ และจำกัดสิทธิ์ผู้เข้า-ออก / Mechanical & Electrical (M&E) plant rooms are clean, organized, and restricted to authorized personnel only.' },
  { id: 30, code: 'A030', catId: 'A', desc: 'หม้อต้มน้ำร้อน (Boiler) มีวิศวกรวิชาชีพเซ็นรับรองการตรวจทดสอบประจำปี / Hot water boilers are inspected and certified annually by a licensed professional engineer.' },
  { id: 31, code: 'A031', catId: 'A', desc: 'เกจวัดแรงดัน วาล์วนิรภัย (Safety Valve) บนหม้อต้มน้ำร้อนทำงานปกติ ไม่ชำรุด / Pressure gauges and safety relief valves on boilers are fully operational and undamaged.' },
  { id: 32, code: 'A032', catId: 'A', desc: 'ถังน้ำมันเชื้อเพลิงสำรอง (Fuel Storage Tank) มีเขตกั้นกันรั่วไหล (Bund Wall / Dike) / Fuel storage tanks are enclosed within proper containment dikes (bund walls) to retain spills.' },
  { id: 33, code: 'A033', catId: 'A', desc: 'เครื่องกำเนิดไฟฟ้าสำรอง (Generator) สภาพพร้อมใช้งาน มีน้ำมันเพียงพอ และทดสอบประจำสัปดาห์ / Backup generators are in ready-to-use condition, adequately fueled, and tested weekly.' },
  { id: 34, code: 'A034', catId: 'A', desc: 'ระบบคูลลิ่งทาวเวอร์ (Cooling Tower) มีการบำบัดน้ำและตรวจเชื้อ ลีจิโอเนลลา (Legionella) ตามรอบ / Cooling tower water systems are treated and periodically tested for Legionella bacteria.' },
  { id: 35, code: 'A035', catId: 'A', desc: 'ท่อลำเลียงสารเคมี น้ำไอน้ำ และแก๊ส มีการทาสีระบุประเภทและทิศทางการไหลชัดเจน / Chemical, steam, and gas supply pipes are clearly color-coded with directional flow arrows.' },
  { id: 36, code: 'A036', catId: 'A', desc: 'ตู้ควบคุมไฟฟ้า (MDB / Sub-panel) มีฝาปิดมิดชิด ติดป้ายเตือนอันตรายไฟฟ้าแรงสูง / Electrical panels (MDB/Sub-panels) are securely closed and labeled with high-voltage warning signs.' },
  { id: 37, code: 'A037', catId: 'A', desc: 'พื้นที่หน้าตู้ MDBไฟฟ้ามีระยะว่างไม่น้อยกว่า 0.8-1.0 เมตร ไม่มีสิ่งของวางกีดขวาง / A clear clearance of at least 0.8–1.0 meters is maintained in front of all electrical panels without obstructions.' },
  { id: 38, code: 'A038', catId: 'A', desc: 'มีการติดตั้งอุปกรณ์ตัดไฟรั่ว (RCD / ELCB) สำหรับปลั๊กไฟในพื้นที่เปียกชื้น (ครัว, ซักล้าง, สระน้ำ) / Residual Current Devices (RCD/ELCB) are installed for electrical outlets in wet zones (kitchen, laundry, pool).' },
  { id: 39, code: 'A039', catId: 'A', desc: 'สายไฟ สายต่อพ่วง อยู่ในสภาพดี ไม่มีรอยถลอก รอยต่อสายใช้เทปพันสายไฟมาตรฐาน / Electrical wiring and extension cords are in good condition without fraying; splices use standard electrical tape.' },
  { id: 40, code: 'A040', catId: 'A', desc: 'อุปกรณ์ไฟฟ้าและเครื่องจักรทุกชนิดมีการต่อสายดิน (Grounding) ถูกต้องและสมบูรณ์ / All electrical appliances and machinery are correctly and completely grounded.' },
  { id: 41, code: 'A041', catId: 'A', desc: 'ไม่มีการใช้อุปกรณ์ต่อพ่วงปลั๊กพ่วง (Adaptor/Power Strip) ต่อซ้อนกันหลายชั้น (Daisy Chaining) / Power strips and adapters are not daisy-chained (plugged into one another).' },
  { id: 42, code: 'A042', catId: 'A', desc: 'มีการสแกนตรวจวัดความร้อนสายไฟและเบรกเกอร์ (Thermal Scan) ประจำปี / Annual thermographic (thermal scan) inspections are performed on electrical wiring and circuit breakers.' },
  { id: 43, code: 'A043', catId: 'A', desc: 'ระบบตัดแก๊สอัตโนมัติ (Gas Solenoid Shut-off Valve) ทำงานร่วมกับระบบแจ้งเหตุไฟไหม้ / Automatic gas solenoid shut-off valves are interlocked with the fire alarm system.' },
  { id: 44, code: 'A044', catId: 'A', desc: 'ท่อส่งแก๊ส ถังแก๊ส มีการตรวจรั่วซึม (Soap Bubble Test / Detector) ตามรอบประจำเดือน / Gas supply lines and LPG cylinders undergo monthly leak checks (soap bubble test or gas detector).' },
  { id: 45, code: 'A045', catId: 'A', desc: 'ฮูดดูดควัน (Kitchen Hood) และระบบระบายอากาศสะอาด ไม่มีคราบไขมันสะสมหนาแน่น / Kitchen exhaust hoods and ventilation systems are clean and free from heavy grease accumulation.' },
  { id: 46, code: 'A046', catId: 'A', desc: 'มีการติดตั้งระบบดับเพลิงอัตโนมัติในฮูดครัว (Ansul / Wet Chemical Suppression System) / Kitchen hoods are equipped with an automatic wet chemical fire suppression system (e.g., Ansul).' },
  { id: 47, code: 'A047', catId: 'A', desc: 'เครื่องจักรประกอบอาหาร (เครื่องบด, เครื่องสไลด์) มีการติดตั้งการ์ดป้องกันอันตราย (Safety Guard) / Food processing machinery (meat grinders, slicers) are fitted with operational safety guards.' },
  { id: 48, code: 'A048', catId: 'A', desc: 'เตาแก๊ส และหม้อต้มความดัน มีวาล์วควบคุมทำงานปกติ ไม่มีความเสี่ยงระเบิด / Gas stoves and pressure vessels have operational control valves with no risk of explosion.' },
  { id: 49, code: 'A049', catId: 'A', desc: 'พื้นที่รอบสระว่ายน้ำใช้วัสดุกันลื่น และอยู่ในสภาพสมบูรณ์ ไม่แตกร้าว / Swimming pool deck areas feature non-slip surfaces and remain in intact condition without cracks.' },
  { id: 50, code: 'A050', catId: 'A', desc: 'มีป้ายบอกระดับความลึกของน้ำ ป้ายเตือน และกฎระเบียบการใช้สระชัดเจน / Water depth indicators, safety warnings, and pool rules are clearly posted around the pool area.' },
  { id: 51, code: 'A051', catId: 'A', desc: 'อุปกรณ์ช่วยชีวิต (Lifebuoy / Rescue Pole / First Aid) อยู่ในจุดที่หยิบง่ายและสมบูรณ์ / Life-saving equipment (lifebuoys, rescue poles, first aid kits) are readily accessible and in complete condition.' },
  { id: 52, code: 'A052', catId: 'A', desc: 'ตะแกรงกรองและฝาท่อสูดน้ำใต้สระ (Suction Outlet Cover) ยึดแน่น ป้องกันการดูดติด (Anti-Entrapment) / Main drain covers and suction outlets are firmly secured and anti-entrapment compliant.' },
  { id: 53, code: 'A053', catId: 'A', desc: 'ห้องเก็บสารเคมีดูแลสระว่ายน้ำ (คลอรีน/กรด) มีระบบระบายอากาศ และกั้นเขตอันตราย / Pool chemical storage rooms (chlorine/acid) are adequately ventilated and designated as restricted hazardous zones.' },
  { id: 54, code: 'A054', catId: 'A', desc: 'อุปกรณ์ฟิตเนส เครื่องออกกำลังกาย มีการตรวจเช็คสายพาน น็อต และสลิงประจำสัปดาห์ / Fitness and gym equipment undergo weekly checks for belts, nuts, bolts, and wire ropes.' },
  { id: 55, code: 'A055', catId: 'A', desc: 'ห้องเก็บของ Store / Stock มีการจัดเก็บสิ่งของเป็นระเบียบ ไม่วางของสูงเกินระยะปลอดภัย / Storage rooms and stockrooms are neatly organized; items are not stacked above safe height limits.' },
  { id: 56, code: 'A056', catId: 'A', desc: 'การวางซ้อนกล่องหรือสินค้า มีความมั่นคง ไม่เสี่ยงต่อการล้มทับ / Stacking of boxes or goods is stable and secured against tipping or falling over.' },
  { id: 57, code: 'A057', catId: 'A', desc: 'มีการแยกเก็บวัตถุไวไฟ นอกอาคารหรือในตู้เก็บสารไวไฟโดยเฉพาะ (Safety Cabinet) / Flammable liquids and materials are stored separately in designated safety cabinets or outdoor areas.' },
  { id: 58, code: 'A058', catId: 'A', desc: 'รถเข็นแม่บ้าน (Housekeeping Trolley) สภาพสมบูรณ์ เบรกทำงานได้ ไม่บดบังทางเดิน / Housekeeping trolleys are in good repair, have working brakes, and do not block corridors or exits.' },
  { id: 59, code: 'A059', catId: 'A', desc: 'จุดพักขยะรวม มีการแยกขยะอันตราย ขยะรีไซเคิล และขยะเปียก อย่างชัดเจน / Central waste collection points clearly segregate hazardous waste, recyclables, and organic/wet waste.' },
  { id: 60, code: 'A060', catId: 'A', desc: 'ถังขยะอันตราย (หลอดไฟ, แบตเตอรี่, กระป๋องสเปรย์) มีฝาปิดมิดชิดและติดป้ายเตือน / Hazardous waste bins (fluorescent tubes, batteries, aerosol cans) are tightly sealed and properly labeled.' },
  { id: 61, code: 'A061', catId: 'A', desc: 'บ่อดักไขมัน (Grease Trap) ในครัว มีการตักคราบและล้างทำความสะอาดตามรอบกำหนด / Kitchen grease traps are routinely cleaned and skimmed according to the maintenance schedule.' },
  { id: 62, code: 'A062', catId: 'A', desc: 'ระบบบำบัดน้ำเสีย (Wastewater Treatment) ทำงานปกติ และมีผลตรวจคุณภาพน้ำทิ้งผ่านเกณฑ์ / Wastewater treatment systems operate normally, and effluent water quality test results meet statutory standards.' },
  { id: 63, code: 'B001', catId: 'B', desc: 'พนักงานแผนกต้อนรับทราบขั้นตอนการแจ้งเหตุฉุกเฉิน และหมายเลขโทรศัพท์ฉุกเฉินทุกหน่วยงาน / Front Office staff know emergency notification procedures and emergency contact numbers for all departments.' },
  { id: 64, code: 'B002', catId: 'B', desc: 'เคาน์เตอร์ต้อนรับมีปุ่มกดแจ้งเหตุฉุกเฉิน (Panic Button) ต่อตรงไปยังห้อง Security / Reception desks are equipped with functional panic buttons directly connected to the Security room.' },
  { id: 65, code: 'B003', catId: 'B', desc: 'พนักงานยกกระเป๋า (Bellman) ใช้ท่าทางการยกของหนักที่ถูกต้องตามหลัก Ergonomics / Bellmen practice proper ergonomic lifting techniques when handling heavy luggage.' },
  { id: 66, code: 'B004', catId: 'B', desc: 'การจัดเก็บสัมภาระลูกค้ารอการเช็คอิน/เช็คเอ้าท์ มีการล็อคกั้นเขตปลอดภัย / Guest luggage storage areas for check-in/check-out are securely locked and restricted.' },
  { id: 67, code: 'B005', catId: 'B', desc: 'แม่บ้านสวมใส่ PPE (ถุงมือยาง, หน้ากาก, รองเท้ากันลื่น) ขณะผสมและใช้น้ำยาทำความสะอาด / Housekeepers wear appropriate PPE (rubber gloves, masks, non-slip shoes) when diluting and using cleaning chemicals.' },
  { id: 68, code: 'B006', catId: 'B', desc: 'ขวดน้ำยาทำความสะอาดแบ่งบรรจุ มีการติดป้ายชื่อสารเคมีและคำเตือนชัดเจน (Secondary Label) / Secondary chemical containers are clearly affixed with chemical names and GHS hazard warning labels.' },
  { id: 69, code: 'B007', catId: 'B', desc: 'พนักงานใช้วิธีการทำความสะอาดกระจกสูงโดยใช้อุปกรณ์ต่องอ ไม่ยืนบนเก้าอี้หรือพิงระเบียง / Staff use extension poles for high glass cleaning without standing on chairs or leaning over balcony edges.' },
  { id: 70, code: 'B008', catId: 'B', desc: 'พนักงานปฏิบัติตามขั้นตอนการปูเตียงและเก็บผ้า เพื่อลดอาการปวดหลังและกล้ามเนื้อ / Staff follow ergonomic bed-making and linen-handling procedures to minimize back and muscle strain.' },
  { id: 71, code: 'B009', catId: 'B', desc: 'การใช้เข็มฉีดยาหรือขยะติดเชื้อที่พบในห้องพัก มีขั้นตอนการจัดการแบบ Biohazard ปลอดภัย / Any syringes or biohazardous waste found in guest rooms are safely handled per Biohazard SOPs.' },
  { id: 72, code: 'B010', catId: 'B', desc: 'พนักงานบริการสวมรองเท้าส้นเตี้ย พื้นยางกันลื่น เพื่อป้องกันการลื่นไถลขณะเดินเสิร์ฟ / Service staff wear flat, slip-resistant rubber-soled shoes to prevent slips while serving.' },
  { id: 73, code: 'B011', catId: 'B', desc: 'แก้วและจานชามที่แตกหัก มีการจัดเก็บใส่ภาชนะแข็งแรงแยกต่างหาก ป้องกันการบาดบาดเจ็บ / Broken glass and chinaware are disposed of in separate rigid containers to prevent cut injuries.' },
  { id: 74, code: 'B012', catId: 'B', desc: 'การเคลื่อนย้ายถังหมัก ถังแก๊สสำหรับเครื่องดื่ม หรือถังเบียร์สด มีรถเข็นเฉพาะและล็อคแน่นหนา / Transporting beverage gas cylinders or beer kegs utilizes dedicated trolleys with secure locking straps.' },
  { id: 75, code: 'B013', catId: 'B', desc: 'ตู้เก็บไวน์ ชั้นวางแก้ว มีโครงสร้างแข็งแรง และยึดติดผนังป้องกันการโค่นล้ม / Wine racks and glassware shelves are structurally sturdy and securely anchored to walls to prevent tipping.' },
  { id: 76, code: 'B014', catId: 'B', desc: 'เชฟและพนักงานครัวสวมใส่ถุงมือกันบาด (Cut-resistant Gloves) ขณะใช้มีดหรือเครื่องสไลด์ / Chefs and kitchen staff wear cut-resistant gloves when using knives or operating food slicers.' },
  { id: 77, code: 'B015', catId: 'B', desc: 'พนักงานสวมรองเท้าเซฟตี้หัวเหล็ก หรือรองเท้ากันลื่นพิเศษสำหรับครัว (Slip-resistant Shoes) / Kitchen staff wear certified slip-resistant footwear or steel-toe safety shoes suitable for kitchen environments.' },
  { id: 78, code: 'B016', catId: 'B', desc: 'มีการใช้ป้ายเตือนความร้อนบริเวณเตาอบ หม้อทอด และเครื่องสติมเมอร์ / Hot surface warning signs are posted near ovens, deep fryers, and steamers.' },
  { id: 79, code: 'B017', catId: 'B', desc: 'ห้องเย็น (Walk-in Cold Room) มีคันโยกเปิดประตูจากด้านใน (Safety Release Handle) / Walk-in cold rooms feature internal safety release handles allowing egress from inside.' },
  { id: 80, code: 'B018', catId: 'B', desc: 'ระบบสัญญาณเตือนติดค้างในห้องเย็น (Cold Room Alarm System) ทำงานได้ปกติ / Cold room trapped-person panic alarm systems are fully operational.' },
  { id: 81, code: 'B019', catId: 'B', desc: 'พนักงานปฏิบัติตามมาตรฐาน HACCP / สุขอภิบาลอาหาร เพื่อป้องกันอาหารเป็นพิษ / Food handlers strictly adhere to HACCP and food hygiene standards to prevent foodborne illnesses.' },
  { id: 82, code: 'B020', catId: 'B', desc: 'น้ำมันทอดที่ใช้แล้ว มีภาชนะรองรับมิดชิด ทิ้งให้เย็นก่อนการเคลื่อนย้าย / Used cooking oil is stored in covered containers and allowed to cool completely before transport.' },
  { id: 83, code: 'B021', catId: 'B', desc: 'เครื่องซักผ้าและเครื่องอบผ้าขนาดใหญ่ มีระบบสวิตช์ความปลอดภัยตัดการทำงานเมื่อเปิดฝา / Commercial washers and dryers feature automatic safety door interlocks that halt operation when opened.' },
  { id: 84, code: 'B022', catId: 'B', desc: 'ท่อไอน้ำและท่อน้ำร้อนมีการห่อหุ้มฉนวนกันความร้อน (Lagging / Insulation) ครบถ้วน / Steam and hot water supply pipes are fully lagged with thermal insulation to prevent burns.' },
  { id: 85, code: 'B023', catId: 'B', desc: 'สารเคมีซักฟอกเข้มข้น มีระบบปั๊มจ่ายอัตโนมัติ ไม่ใช้มือตักโดยตรงเพื่อลดการสัมผัส / Concentrated laundry detergents are dispensed via automatic dosing pumps to avoid direct chemical contact.' },
  { id: 86, code: 'B024', catId: 'B', desc: 'มีการดักและทำความสะอาดขุยผ้า (Lint Filter) ในเครื่องอบผ้าทุกวัน เพื่อป้องกันการขุมไหม้ / Dryer lint filters are cleaned daily to eliminate fire hazards caused by accumulated lint.' },
  { id: 87, code: 'B025', catId: 'B', desc: 'ช่างช่างซ่อมบำรุงปฏิบัติตามขั้นตอน Lockout / Tagout (LOTO) ก่อนซ่อมแซมเครื่องจักร/ไฟฟ้า / Maintenance technicians strictly enforce Lockout/Tagout (LOTO) procedures prior to servicing equipment or electrical systems.' },
  { id: 88, code: 'B026', catId: 'B', desc: 'การทำงานบนที่สูง (นั่งร้าน/บันได) มีการใช้สายรัดนิรภัย (Full Body Harness) และจุดยึดเกาะ / Working at heights (scaffolding/ladders) requires full-body safety harnesses secured to certified anchor points.' },
  { id: 89, code: 'B027', catId: 'B', desc: 'ช่างใช้อุปกรณ์เครื่องมือช่างที่สมบูรณ์ ไม่แตกร้าว ด้ามจับมีฉนวนกันไฟฟ้า / Hand tools are undamaged, uncracked, and feature insulated handles for electrical safety.' },
  { id: 90, code: 'B028', catId: 'B', desc: 'งานที่ก่อให้เกิดความร้อน/ประกายไฟ (Hot Work) มีใบอนุญาตทำงานและถังดับเพลิงแสตนด์บาย / Hot Work operations require an authorized Permit-to-Work (PTW) and a standby fire extinguisher.' },
  { id: 91, code: 'B029', catId: 'B', desc: 'การทำงานในพื้นที่อับอากาศ (Confined Space) มีการวัดก๊าซและใบอนุญาตถูกต้อง / Confined space entries require atmospheric gas testing and valid entry permits.' },
  { id: 92, code: 'B030', catId: 'B', desc: 'กล้องวงจรปิด (CCTV) ครอบคลุมจุดเสี่ยง ทางเข้า-ออก โถง และทำงานปกติ 24 ชม. / CCTV coverage spans key risk areas, entrances, exits, and lobbies, functioning continuously 24/7.' },
  { id: 93, code: 'B031', catId: 'B', desc: 'รปภ. ตรวจตราพื้นที่ (Guard Tour System) ครบถ้วนตามจุดและเวลาที่กำหนด / Security guards perform patrols according to designated guard tour routes and schedules.' },
  { id: 94, code: 'B032', catId: 'B', desc: 'มีการลงทะเบียนแลกบัตรและบันทึกผู้มาติดต่อ / ผู้รับเหมาอย่างเคร่งครัด / Visitor and contractor logbooks and visitor badge exchanges are strictly enforced.' },
  { id: 95, code: 'B033', catId: 'B', desc: 'พนักงาน รปภ. ได้รับการฝึกอบรมการระงับเหตุทะเลาะวิวาท และการควบคุมฝูงชน / Security officers are trained in conflict de-escalation, physical restraint, and crowd control.' },
  { id: 96, code: 'B034', catId: 'B', desc: 'รถรับส่งลูกค้า (Hotel Shuttle / Limousine) มีการตรวจเช็คสภาพเครื่องยนต์ เบรก ยาง ตามรอบ / Hotel shuttles and guest vehicles undergo periodic maintenance checks for engine, brakes, and tires.' },
  { id: 97, code: 'B035', catId: 'B', desc: 'เข็มขัดนิรภัยสำหรับผู้ขับขี่และผู้โดยสารทุกที่นั่งสามารถใช้งานได้สมบูรณ์ / Seat belts for the driver and all passenger seats are fully functional and in good condition.' },
  { id: 98, code: 'B036', catId: 'B', desc: 'มีถังดับเพลิงขนาดเล็กและชุดปฐมพยาบาลติดตั้งประจำอยู่ในรถยนต์ทุกคัน / All company vehicles are equipped with a compact fire extinguisher and a First Aid kit.' },
  { id: 99, code: 'B037', catId: 'B', desc: 'พนักงานขับรถได้รับการตรวจวัดระดับแอลกอฮอล์ และพักผ่อนเพียงพอก่อนปฏิบัติงาน / Drivers undergo zero-tolerance alcohol breathalyzer tests and are verified for sufficient rest before duty.' },
  { id: 100, code: 'C001', catId: 'C', desc: 'มีการจัดสรรอุปกรณ์คุ้มครองความปลอดภัยส่วนบุคคล (PPE) ให้พนักงานฟรีตามลักษณะงาน / Appropriate Personal Protective Equipment (PPE) is provided free of charge according to job hazard levels.' },
  { id: 101, code: 'C002', catId: 'C', desc: 'พนักงานสวมใส่ PPE สม่ำเสมอและถูกต้องขณะปฏิบัติงานเสี่ยงอันตราย / Employees consistently and correctly wear required PPE during hazardous work operations.' },
  { id: 102, code: 'C003', catId: 'C', desc: 'มีสถานที่จัดเก็บ PPE ที่สะอาด ถูกสุขลักษณะ และมีการตรวจเช็คเปลี่ยนใหม่เมื่อชำรุด / PPE is stored in a clean, hygienic area, with periodic inspections and immediate replacement for damaged items.' },
  { id: 103, code: 'C004', catId: 'C', desc: 'สถานีงานสำนักงาน (Office Workstation) มีเก้าอี้ปรับระดับได้ จอภาพอยู่ในระดับสายตา / Office workstations feature adjustable ergonomic chairs and monitors set at eye level.' },
  { id: 104, code: 'C005', catId: 'C', desc: 'พนักงานยกของหนักปฏิบัติตามหลักการยก safe lifting (ไม่เกิน 20 กก. สำหรับหญิง / 55 กก. สำหรับชาย) / Manual handling adheres to legal lifting weight limits (maximum 20 kg for females / 55 kg for males).' },
  { id: 105, code: 'C006', catId: 'C', desc: 'พนักงานที่ต้องยืนทำงานนานๆ (เช่น Reception, Kitchen) มีแผ่นยางรองยืนลดความเมื่อยล้า (Anti-fatigue Mat) / Anti-fatigue mats are provided at prolonged standing workstations (e.g., reception counter, kitchen lines).' },
  { id: 106, code: 'C007', catId: 'C', desc: 'มีเอกสารข้อมูลความปลอดภัยสารเคมี (SDS / MSDS) ภาษาไทย/อังกฤษ ครบถ้วน ณ จุดใช้งาน / Safety Data Sheets (SDS/MSDS) in both Thai and English are readily available at chemical point-of-use areas.' },
  { id: 107, code: 'C008', catId: 'C', desc: 'พนักงานผ่านการฝึกอบรมการใช้น้ำยา/สารเคมี การอ่านป้าย SDS และการปฐมพยาบาล / Staff are trained in chemical handling, reading SDS hazard labels, and emergency first aid responses.' },
  { id: 108, code: 'C009', catId: 'C', desc: 'มีอ่างล้างตาฉุกเฉิน (Emergency Eyewash) และฝักบัวฉุกเฉิน ใกล้จุดใช้สารเคมีเข้มข้น / Emergency eyewash stations and safety showers are installed near concentrated chemical handling areas.' },
  { id: 109, code: 'C010', catId: 'C', desc: 'มีชุดอุปกรณ์จัดการสารเคมีรั่วไหล (Spill Kit) และพนักงานรู้วิธีการใช้งาน / Chemical spill kits are accessible, and staff are trained in spill containment procedures.' },
  { id: 110, code: 'C011', catId: 'C', desc: 'กล่อง/ชุดปฐมพยาบาล (First Aid Kit) มีอุปกรณ์ ยาครบถ้วนตามกฎหมายกำหนด ไม่หมดอายุ / First Aid kits are fully stocked with unexpired medical supplies in compliance with statutory requirements.' },
  { id: 111, code: 'C012', catId: 'C', desc: 'มีเครื่องกระตุกหัวใจไฟฟ้าอัตโนมัติ (AED) ติดตั้งในจุดที่เข้าถึงง่าย และพร้อมใช้งานตลอดเวลา / Automated External Defibrillators (AEDs) are installed in easily accessible locations and ready for use.' },
  { id: 112, code: 'C013', catId: 'C', desc: 'มีพนักงานที่ผ่านการฝึกอบรมการปฐมพยาบาลและ CPR ปฏิบัติงานในทุกกะ / Certified First Aiders trained in CPR are present on duty across all work shifts.' },
  { id: 113, code: 'C014', catId: 'C', desc: 'โรงอาหารพนักงาน (Canteen) สะอาด ถูกสุขอนามัย และมีน้ำดื่มสะอาดเพียงพอ / The staff canteen is clean, hygienic, and provides adequate potable drinking water.' },
  { id: 114, code: 'C015', catId: 'C', desc: 'ห้องน้ำพนักงานแยกชาย-หญิง มีจำนวนเพียงพอ และทำความสะอาดสม่ำเสมอ / Staff restrooms are gender-segregated, sufficient in number, and routinely sanitized.' },
  { id: 115, code: 'C016', catId: 'C', desc: 'ห้องพักพนักงาน (Locker Room / Rest Area) มีอากาศถ่ายเทดี ไม่แออัด / Employee locker rooms and rest areas are adequately ventilated and uncrowded.' },
  { id: 116, code: 'C017', catId: 'C', desc: 'มีการตรวจสุขภาพประจำปีตามปัจจัยเสี่ยง (เช่น สารเคมี, เสียงดัง, ยกของหนัก) ให้พนักงาน / Annual risk-based health check-ups (chemical exposure, noise, heavy lifting) are conducted for employees.' },
  { id: 117, code: 'C018', catId: 'C', desc: 'มีการบันทึกและประเมินผลการตรวจสุขภาพ พร้อมมาตรการดูแลพนักงานที่พบความผิดปกติ / Medical examination records are evaluated, with follow-up protocols for employees showing medical abnormalities.' },
  { id: 118, code: 'C019', catId: 'C', desc: 'พนักงานใหม่ทุกคนผ่านการปฐมนิเทศด้านความปลอดภัย (Safety Orientation) ก่อนเริ่มงาน / All new hires complete a mandatory safety orientation before commencing work duties.' },
  { id: 119, code: 'C020', catId: 'C', desc: 'พนักงานที่ทำงานเสี่ยง (ช่าง, ช่างไฟฟ้า, ผู้ขับขี่) มีใบอนุญาตหรือผ่านการอบรมเฉพาะทาง / High-risk role workers (electricians, high-work technicians, drivers) hold valid professional licenses or certifications.' },
  { id: 120, code: 'D001', catId: 'D', desc: 'มีการจัดทำแผนป้องกันและระงับอัคคีภัยประจำปีอย่างเป็นลายลักษณ์อักษร / A written annual fire prevention and suppression plan is officially established and documented.' },
  { id: 121, code: 'D002', catId: 'D', desc: 'เส้นทางอพยพหนีไฟและจุดรวมพล (Assembly Point) มีป้ายบอกชัดเจน ปลอดภัย / Evacuation routes and Assembly Points are clearly marked with signage and situated in safe locations.' },
  { id: 122, code: 'D003', catId: 'D', desc: 'ระบบเสียงประกาศฉุกเฉิน (Public Address / PA System) สามารถได้ยินชัดเจนทั่วอาคาร / Public Address (PA) emergency announcement systems are clearly audible throughout the entire building.' },
  { id: 123, code: 'D004', catId: 'D', desc: 'มีไฟฉายฉุกเฉิน วิทยุสื่อสาร และอุปกรณ์กู้ภัยในห้องศูนย์ควบคุมความปลอดภัย (FCC) / Emergency flashlights, two-way radios, and rescue equipment are maintained in the Fire Control Center (FCC).' },
  { id: 124, code: 'D005', catId: 'D', desc: 'มีการแต่งตั้งทีมตอบโต้สถานการณ์ฉุกเฉิน (ERT) ครบถ้วนทุกกะปฏิบัติงาน / Emergency Response Teams (ERT) are formally appointed and assigned across all operational shifts.' },
  { id: 125, code: 'D006', catId: 'D', desc: 'มีการฝึกซ้อมดับเพลิงและการฝึกซ้อมอพยพหนีไฟอย่างน้อยปีละ 1 ครั้ง ร่วมกับพนักงานทุกคน / Mandatory annual fire drills and evacuation drills are conducted involving all staff members.' },
  { id: 126, code: 'D007', catId: 'D', desc: 'มีขั้นตอนการปฏิบัติตามแผนวิกฤต (Crisis Management Plan) เช่น แผ่นดินไหว, น้ำท่วม, ก๊าซรั่ว / Standard Operating Procedures exist for crisis management plans (e.g., earthquakes, floods, gas leaks).' },
  { id: 127, code: 'E001', catId: 'E', desc: 'มีใบอนุญาตประกอบกิจการที่เกี่ยวข้องครบถ้วนและไม่หมดอายุ (ใบอนุญาตประกอบธุรกิจโรงแรม, สุขาภิบาลอาหาร/สะสมอาหาร, สุขาภิบาลน้ำทิ้ง, สะสมน้ำมันเชื้อเพลิง) / All relevant operating permits (Hotel Operating License, Food Sanitation, Fuel Storage) are valid and updated.' },
  { id: 128, code: 'E002', catId: 'E', desc: 'อาคารโรงแรมได้รับการตรวจเช็คสภาพอาคารและระบบความปลอดภัยประจำปี โดยวิศวกรวิชาชีพเซ็นรับรอง (ใบ ร.1) / Building safety inspections are certified annually by a licensed professional engineer (R.1 Form).' },
  { id: 129, code: 'E003', catId: 'E', desc: 'ลิฟต์โดยสาร/ลิฟต์บริการ (บ.ภ.11), หม้อน้ำต้มน้ำร้อน (Boiler) และภาชนะรับแรงดัน ได้รับการตรวจทดสอบและมีเอกสารรับรองความปลอดภัยประจำปี / Elevators (B.P.11), boilers, and pressure vessels are tested and certified annually by engineers.' },
  { id: 130, code: 'E004', catId: 'E', desc: 'มีการวัดและประเมินสภาพแวดล้อมในการทำงาน (แสงสว่างในสำนักงาน, เสียง/ความร้อนในห้องเครื่องและครัว) ประจำปีตามกฎหมาย / Annual workplace environment monitoring (lighting, noise, heat) is conducted per legal standards.' },
  { id: 131, code: 'E005', catId: 'E', desc: 'มีการแต่งตั้งคณะกรรมการ คปอ., ประชุมประจำเดือน และยื่นรายงานผลการดำเนินงานด้านความปลอดภัย (จป-ส / สม.9) ต่อกรมฯ ตามกำหนด / OSH Committee is appointed, meets monthly, and statutory safety reports are submitted on time.' },
  { id: 132, code: 'F001', catId: 'F', desc: 'พนักงานโรงแรมได้รับการฝึกอบรมการป้องกันและระงับอัคคีภัยขั้นต้น (Basic Fire Fighting) ไม่น้อยกว่า 40% ของพนักงานในแต่ละแผนก / At least 40% of total staff in every department receive certified Basic Fire Fighting Training.' },
  { id: 133, code: 'F002', catId: 'F', desc: 'พนักงานทุกคนได้รับการฝึกซ้อมดับเพลิงและซ้อมอพยพหนีไฟร่วมกันอย่างน้อยปีละ 1 ครั้ง (ร่วมกับแผนจำลองสถานการณ์ฉุกเฉิน) / All employees participate in the mandatory annual fire fighting and evacuation drill.' },
  { id: 134, code: 'F003', catId: 'F', desc: 'พนักงานใหม่ทุกคนผ่านการอบรมปฐมนิเทศความปลอดภัย (Safety Orientation) ก่อนเริ่มงาน และพนักงานครัว/ช่าง ผ่านการอบรมงานเสี่ยงเฉพาะทาง / New hires complete OSH orientation; kitchen and engineering staff complete task-specific safety training.' },
  { id: 135, code: 'F004', catId: 'F', desc: 'มีพนักงานประจำในทุกกะ (โดยเฉพาะแผนก Front Office, สระว่ายน้ำ, ครัว, ช่าง) ผ่านการอบรม First Aid, CPR และการใช้ AED / Designated staff on all shifts (Front Desk, Pool, Kitchen, M&E) are certified in First Aid & CPR/AED.' },
  { id: 136, code: 'F005', catId: 'F', desc: 'พนักงานแม่บ้าน ครัว และช่าง ได้รับการฝึกอบรมการใช้สารเคมีทำความสะอาดอย่างปลอดภัย การอ่านป้าย SDS และหลักสุขอนามัยอาหาร / Housekeeping, kitchen, and engineering staff are trained in chemical safety, SDS labels, and food hygiene.' }
];

export const DEFAULT_PROPERTIES: string[] = [
  "Lub d Bangkok Chinatown",
  "Lub d Bangkok Siam",
  "Lub d Koh Samui Chaweng Beach",
  "Lub d Koh Tao Tanote Bay",
  "Lub d Philippines Makati",
  "Lub d Phuket Patong",
  "Lub d Siem Reap",
  "Marasca Samui",
];

/** The "NARAI Format" report template - verbatim from the prototype. Built
 * from whatever categories/items it is given, so Setting > Report Templates'
 * "load NARAI Format" button regenerates it against the CURRENT checklist. */
export const generateDefaultTemplate = (cats: OshCategory[], items: OshChecklistItem[]): string => {
  let html = `
<div style="font-family: 'Sarabun', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #000; max-width: 1000px; margin: 0 auto; padding: 20px; background: #fff;">
  <div style="text-align: center; margin-bottom: 25px;">
    <h1 style="margin: 0; font-size: 22px; text-transform: uppercase;">NARAI HOSPITALITY GROUP</h1>
    <h2 style="margin: 8px 0 4px 0; font-size: 18px;">Occupational safety and health (OSH) Checklist Form</h2>
    <h3 style="margin: 0; font-size: 16px; font-weight: normal;">แบบตรวจการป้องกันอัคคีภัยในสถานประกอบกิจการ</h3>
  </div>
  
  <table style="width: 100%; border: none; margin-bottom: 20px; font-size: 14px;">
    <tr>
      <td style="width: 50%; padding: 4px 0;"><strong>Location:</strong> {{PropertyName}}</td>
      <td style="width: 50%; padding: 4px 0;"><strong>Date:</strong> {{Date}}</td>
    </tr>
    <tr>
      <td style="padding: 4px 0;"><strong>Year:</strong> {{Year}}</td>
      <td style="padding: 4px 0;"><strong>Check by:</strong> {{Operator}}</td>
    </tr>
    <tr>
      <td style="padding: 4px 0;"><strong>Round:</strong> {{Period}}</td>
      <td></td>
    </tr>
  </table>


  <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
    <thead>
      <tr style="background: #f1f5f9;">
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 60px;">Item No.</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">Checklist Description</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 70px;">Status</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 80px;">Sub Status</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 150px;">Action Plan</th>
        <th style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; width: 90px;">Photo</th>
      </tr>
    </thead>
    <tbody>`;


  cats.forEach((c) => {
    html += `
      <tr style="background: #f8fafc;">
        <td colspan="6" style="padding: 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f172a;">
          ${c.name}
        </td>
      </tr>`;
    const catItems = items.filter((i) => i.catId === c.id);
    catItems.forEach((i) => {
      html += `
      <tr>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; vertical-align: top;">${i.code}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; vertical-align: top;">${i.desc}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; vertical-align: top;">{{${i.code}_Status}}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; vertical-align: top;">{{${i.code}_SubStatus}}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; vertical-align: top;">{{${i.code}_Plan}}</td>
        <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: center; vertical-align: top;">{{${i.code}_Photo}}</td>
      </tr>`;
    });
  });


  html += `
    </tbody>
  </table>
  <div style="margin-top: 20px; font-size: 12px; color: #64748b; text-align: right;">Generated by OSH System</div>
</div>`;
  return html;
};
