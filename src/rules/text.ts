// Rule text shown in the UI when a rule fires (spec §4). Source: the faculty finance
// officer's note on the trip, summarised. Keep the wording here, not in the UI code.

export const RULES = {
  perDiemDays: {
    id: 'per-diem.day-count',
    text: 'Per diem: DPA calculates it from the four times. Every full 24 hours counts as one day, and a remainder over 12 hours counts as one more day.',
  },
  perDiemShortTrip: {
    id: 'per-diem.short-trip',
    text: 'Trip under 24 hours: the extension counts a day only when the time is over 12 hours. The half-day rule for trips without an overnight stay (over 6 hours) is not encoded. Check DPA\'s figure.',
  },
  perDiemTimesUnconfirmed: {
    id: 'per-diem.times-unconfirmed',
    text: 'Departure and return times are estimates from the boarding passes. Confirm both before filling.',
  },
  perDiemNoFlights: {
    id: 'per-diem.no-flights',
    text: 'No boarding passes, so departure and return times come from the DPA trip dates and the default work hours. Enter the real times.',
  },
  hotelNeedsFolio: {
    id: 'hotel.receipt-and-folio',
    text: 'Hotel: the receipt and the folio must be submitted together.',
  },
  hotelCap: {
    id: 'hotel.cap',
    text: 'Hotel: claim at most nights × entitlement rate. If the receipt is higher, claim the capped amount and the receipt must say "เบิกจ่ายเพียง X บาท".',
  },
  hotelNightsMismatch: {
    id: 'hotel.nights',
    text: 'Hotel: the number of nights on the folio does not match the check-in and check-out dates, or the trip dates.',
  },
  hotelRounding: {
    id: 'hotel.rounding',
    text: 'Hotel: the rate per night is the receipt total divided by the nights, rounded to satang. DPA multiplies it back, so the claim can differ from the receipt by a few satang.',
  },
  airfareDocs: {
    id: 'airfare.receipt-and-boarding-pass',
    text: 'Airfare: needs the receipt or tax invoice and the boarding pass.',
  },
  airfareAddons: {
    id: 'airfare.claimable-items',
    text: 'Airfare: only the fare and airport tax are claimable. Seat selection, baggage, insurance, convenience or processing fees and other add-ons are not.',
  },
  airfareNoItemisation: {
    id: 'airfare.no-itemisation',
    text: 'Airfare: the receipt does not itemise the fare and taxes, so the claim uses the total. Check that it holds no add-ons.',
  },
  airfareTaxInvoice: {
    id: 'airfare.tax-invoice',
    text: 'Reminder: request a tax invoice (ใบกำกับภาษี) in the university\'s name from the airline if you have not.',
  },
  oneFilePerLine: {
    id: 'evidence.one-file',
    text: 'DPA takes one PDF per claim line. Merging signed PDFs breaks the signatures, so use Prepare for signing to merge the scans, then sign the merged file in Acrobat.',
  },
  pdfOnly: {
    id: 'evidence.pdf-only',
    text: 'DPA accepts PDF evidence only. Convert images with Prepare for signing, then sign the PDF.',
  },
  unsigned: {
    id: 'evidence.signed',
    text: 'Evidence must be signed in Adobe Acrobat with the KKU Digital ID before upload.',
  },
  modifiedAfterSigning: {
    id: 'evidence.modified',
    text: 'The PDF has bytes after the signed range, so it was changed after signing. Re-sign it.',
  },
  billedTo: {
    id: 'receipt.billed-to',
    text: 'Receipts should be made out to the university unit and its tax ID. A receipt in a personal name may be rejected.',
  },
  taxi: {
    id: 'vehicle.taxi',
    text: 'Taxi or private car needs form บก.111. Not handled by this version.',
  },
  budgetTotal: {
    id: 'budget.total',
    text: 'Budget: the total claim is over the approved amount (ขออนุมัติงบประมาณ).',
  },
  budgetCategory: {
    id: 'budget.category',
    text: 'Budget: this category is over its line in the approved estimate.',
  },
  budgetNoEstimate: {
    id: 'budget.no-estimate',
    text: 'Budget: this category has no approved estimate.',
  },
  duplicate: {
    id: 'dpa.duplicate',
    text: 'DPA already has a line with the same item and amount. It will be skipped.',
  },
  existingDifferent: {
    id: 'dpa.existing-different',
    text: 'DPA already has a line for this item with a different amount. Remove it in DPA first, or skip this line.',
  },
  extraction: {
    id: 'extraction.quality',
    text: 'The reader was not sure about this document. Check every value against the page.',
  },
  missingEntitlement: {
    id: 'dpa.entitlement',
    text: 'Could not read the traveller\'s entitlement rates from the trip form.',
  },
} as const;
