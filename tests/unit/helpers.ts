// Synthetic, anonymised documents shaped like the model's output for the spec's test
// set: an ibis receipt and folio, two AirAsia boarding passes and an e-tax invoice.
import type { ExtractedDocument, IngestedFile, TripContext } from '../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

export function doc(over: Partial<ExtractedDocument>): ExtractedDocument {
  return {
    doc_type: 'other',
    pages: [1],
    issuer_name: '',
    issuer_tax_id: null,
    billed_to_name: null,
    billed_to_tax_id: null,
    receipt_no: null,
    receipt_date: null,
    currency: 'THB',
    total_amount: null,
    vat_amount: null,
    line_items: [],
    passenger_or_guest_name: null,
    flight: null,
    stay: null,
    handwritten_notes: null,
    evidence: [],
    confidence: 'high',
    problems: [],
    ...over,
  };
}

export function file(id: string, extracted: ExtractedDocument, over: Partial<IngestedFile> = {}): IngestedFile {
  return {
    id,
    name: `${id}.pdf`,
    mime: 'application/pdf',
    size: 1000,
    sha256: id.padEnd(64, '0'),
    signature: { signed: true, signatures: [{ signerName: 'TEST SIGNER', signingTime: null, coversWholeFile: true }] },
    extracted,
    ...over,
  };
}

export const ibisCombined = (total = 4321.5, nights = 3) =>
  doc({
    doc_type: 'hotel_receipt_and_folio',
    pages: [1, 2],
    issuer_name: 'ibis Chiang Mai Nimman',
    billed_to_name: 'มหาวิทยาลัยขอนแก่น',
    billed_to_tax_id: '0000000000000',
    receipt_no: 'RC-0001',
    receipt_date: '2026-11-13',
    total_amount: total,
    line_items: [{ description: 'Room charge', amount: total, category: 'room' }],
    passenger_or_guest_name: 'TEST TRAVELLER',
    stay: { check_in: '2026-11-10', check_out: '2026-11-13', nights, room_no: '512' },
    evidence: [
      { field: 'total_amount', page: 1, quote: total.toFixed(2) },
      { field: 'stay.nights', page: 2, quote: `${nights} Nights` },
    ],
  });

export const boardingPass = (date: string, from: string, to: string, flightNo: string, boarding: string, arrival: string | null = null, ref = 'ABC123') =>
  doc({
    doc_type: 'boarding_pass',
    issuer_name: 'AirAsia',
    passenger_or_guest_name: 'TEST/TRAVELLER MR',
    flight: { carrier: 'FD', flight_no: flightNo, booking_ref: ref, from_iata: from, to_iata: to, date, boarding_time: boarding, departure_time: null, arrival_time: arrival },
    evidence: [{ field: 'flight.boarding_time', page: 1, quote: boarding }],
  });

export const airfareInvoice = (ref = 'ABC123') =>
  doc({
    doc_type: 'airfare_receipt',
    issuer_name: 'Thai AirAsia Co., Ltd.',
    billed_to_name: 'Khon Kaen University',
    billed_to_tax_id: '0000000000000',
    receipt_no: 'INV-77',
    total_amount: 4890,
    line_items: [
      { description: 'Base fare', amount: 3380, category: 'fare' },
      { description: 'Airport tax (PSC)', amount: 200, category: 'airport_tax' },
      { description: 'Fuel surcharge', amount: 600, category: 'fare' },
      { description: 'Seat selection', amount: 260, category: 'addon' },
      { description: 'Checked baggage 20kg', amount: 400, category: 'addon' },
      { description: 'Processing fee', amount: 50, category: 'fare' },
    ],
    flight: { carrier: 'FD', flight_no: '', booking_ref: ref, from_iata: 'KKC', to_iata: 'CNX', date: '2026-11-10', boarding_time: null, departure_time: null, arrival_time: null },
    evidence: [{ field: 'total_amount', page: 1, quote: '4,890.00' }],
  });

export const ctx = (over: Partial<TripContext> = {}): TripContext => ({
  tripNo: 'TRIP20260000001',
  departDate: '2026-11-10',
  startDate: '2026-11-11',
  endDate: '2026-11-13',
  returnDate: '2026-11-13',
  province: 'เชียงใหม่',
  workLocation: 'Test venue',
  purpose: 'Test meeting',
  estimate: { perDiem: 960, hotel: 4500, vehicle: 4540, other: 0, requested: 10000 },
  traveller: { name: 'TEST TRAVELLER', entitlement: 'แพทย์', perDiemRate: 240, roomType: 'ห้องพักเดี่ยว', roomRate: 1500 },
  financeNotes: [],
  summaryClaimed: null,
  ...over,
});

export const settings = { ...DEFAULT_SETTINGS };
