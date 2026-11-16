// Every DPA label string the extension relies on, in one place (spec §10).
// When DPA changes a label, change it here. The self-test in the side panel checks
// that each REQUIRED label is present on the page before anything is filled.
//
// Strings recorded from saved copies of KKU.BusinessTrip.Input.Form, Nov 2026.

export const LABELS = {
  // Trip context
  tripNo: 'เลขที่ขออนุมัติ',
  tripNoPattern: /TRIP\d{11}/,

  // Activity grid (one row per activity)
  activityGridHeaders: ['วันที่ออกเดินทาง', 'วันที่เริ่มต้น', 'วันที่สิ้นสุด', 'วันที่เดินทางกลับ'],
  colDepartDate: 'วันที่ออกเดินทาง',
  colStartDate: 'วันที่เริ่มต้น',
  colEndDate: 'วันที่สิ้นสุด',
  colReturnDate: 'วันที่เดินทางกลับ',
  colProvince: 'จังหวัด/ประเทศ ที่ปฏิบัติงานหลัก',
  colWorkLocation: 'สถานที่ปฏิบัติงาน',
  colPurpose: 'เดินทางไปปฏิบัติงานเกี่ยวกับ (ระบุให้ชัดเจน)',

  // Approved estimate block
  estPerDiem: '1. ค่าเบี้ยเลี้ยง',
  estHotel: '2. ค่าที่พัก',
  estVehicle: '3. ค่าพาหนะ',
  estOther: '4. อื่นๆ',
  estRequested: 'ขออนุมัติงบประมาณ จำนวน',
  estAirfareGridHeader: 'ค่าบัตรโดยสารเครื่องบิน',

  // Traveller grid (รายชื่อผู้เดินทางไปปฏิบัติงาน)
  travellerGridHeaders: ['สิทธิของเบิก', 'อัตราค่าเบี้ยเลี้ยง', 'อัตราค่าห้องพัก'],
  colTravellerName: 'ชื่อ - สกุล',
  colEntitlement: 'สิทธิของเบิก',
  colPerDiemRate: 'อัตราค่าเบี้ยเลี้ยง',
  colRoomType: 'ประเภทห้องพัก',
  colRoomRate: 'อัตราค่าห้องพัก',

  // Claim table (ค่าใช้จ่ายในการเดินทางไปปฏิบัติงาน)
  claimGridHeaders: ['รายการเบิก', 'หลักฐานการเบิก', 'Signed By'],
  colClaimName: 'ชื่อ - สกุล',
  colClaimItem: 'รายการเบิก',
  colClaimEvidence: 'หลักฐานการเบิก',
  colClaimSignedBy: 'Signed By',
  colClaimDays: 'เบี้ยเลี้ยง (วัน)',
  colClaimNights: 'ที่พัก (คืน)',
  colClaimAmount: 'จำนวน',
  colClaimTimes: 'วันที่',

  // History grid (ประวัติเอกสาร)
  historyGridHeaders: ['ผู้ดำเนินการ', 'ดำเนินการ', 'ความเห็น'],
  colHistoryActor: 'ผู้ดำเนินการ',
  colHistoryAction: 'ดำเนินการ',
  colHistoryComment: 'ความเห็น',
  colHistoryWhen: 'วัน-เวลา',

  // Summary
  summaryClaimed: 'ขอเบิกจ่าย',
  summaryRequested: 'ขออนุมัติงบประมาณ',

  // Claim entry panel
  panelName: 'ชื่อ - นามสกุล',
  panelEmail: 'Email',
  category: 'หมวดรายการที่เบิก',
  item: 'รายการที่เบิก',
  leave: 'การเดินทางคร่อมวันลาหรือวันหยุด',
  tDepart: 'วันเวลาเดินทางออกจากต้นทาง',
  tStart: 'วันเวลาเริ่มปฏิบัติงาน',
  tEnd: 'วันเวลาสิ้นสุดปฏิบัติงาน',
  tReturn: 'วันเวลาเดินทางกลับถึงที่ตั้ง',
  perDiemDuration: 'รวมเวลาค่าเบี้ยเลี้ยง',
  perDiemDays: 'เบี้ยเลี้ยงจำนวน',
  ratePerDay: 'อัตราต่อวัน',
  nights: 'ที่พักจำนวน',
  ratePerNight: 'อัตราต่อคืน',
  amount: 'ระบุจำนวนเงิน',
  computedTotal: 'เป็นเงินจำนวน',
  note: 'ค่าใช้จ่ายอื่นๆ ระบุ…',
  evidence: 'หลักฐานค่าใช้จ่าย',

  btnAddLine: 'เพิ่มรายการขอเบิก',
  btnRemoveLine: 'ลบรายการขอเบิก',
  btnClear: 'ล้างข้อมูล',
} as const;

/** Radio options of หมวดรายการที่เบิก. */
export const CATEGORY = {
  perDiem: 'ค่าเบี้ยเลี้ยง',
  hotel: 'ค่าที่พัก',
  vehicle: 'ค่ายานพาหนะ',
  other: 'ค่าใช้จ่ายอื่นๆ',
} as const;

/** Options of รายการที่เบิก, per category, domestic trips. */
export const ITEM = {
  perDiemDomestic: 'ค่าเบี้ยเลี้ยงเดินทางในประเทศ',
  hotelDomestic: 'ค่าที่พักเดินทางในประเทศ',
  vehicleDomestic: 'ค่าพาหนะเดินทางในประเทศ',
  airfareDomestic: 'ค่าบัตรโดยสารเครื่องบินในประเทศ',
} as const;

export const LEAVE_NONE = 'ไม่มีการลา';

/**
 * Buttons the extension must never press (spec §2 rule 1). The DOM driver refuses
 * to click any element whose text contains one of these, whatever code asks it to.
 * บันทึกเอกสาร (save draft) is also refused in this version: saving is milestone 6.
 */
export const DENY_BUTTONS = [
  'ส่งเอกสารขออนุมัติเบิกจ่าย',
  'ส่งอนุมัติ',
  'ส่งเอกสารคำร้อง',
  'ส่งให้ผู้ขอแก้ไขเอกสาร',
  'บันทึกเอกสาร',
  // Also present on the trip form (seen in the saved copies). None are ours to press.
  'บันทึกข้อมูล',
  'ยกเลิกการเดินทาง',
  'เปลี่ยนแปลง/ยกเลิกการเดินทาง',
  'ไม่เบิกจ่ายงบประมาณที่ขอ',
  'ไม่อนุมัติ',
  'รับรองการส่งเอกสาร',
  'แก้ไขข้อมูลการเบิกจ่าย',
  'แก้ไขเอกสาร',
  'ลบข้อมูลผู้เดินทาง',
  'ลบไฟล์',
  'ลบรายการ',
] as const;

/**
 * The only K2 buttons the driver may press. Anything else that looks like a button is
 * refused, so a new button DPA adds later is refused too.
 */
export const ALLOW_BUTTONS = ['เพิ่มรายการขอเบิก', 'ล้างข้อมูล'] as const;

/** Labels that must exist on the trip form before filling (self-test). */
export const REQUIRED_PANEL_LABELS = [
  LABELS.category,
  LABELS.item,
  LABELS.tDepart,
  LABELS.tStart,
  LABELS.tEnd,
  LABELS.tReturn,
  LABELS.computedTotal,
  LABELS.btnAddLine,
  LABELS.btnClear,
] as const;
