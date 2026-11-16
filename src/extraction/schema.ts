// JSON schema for the extraction reply, in the form structured outputs accepts: every
// property required, additionalProperties false, nullable as a union.
// One reply per file: { documents: [...] }, one entry per document in the file (spec §6
// shape for each), because one signed PDF usually holds several documents.

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const nstr = { type: ['string', 'null'] } as const;
const nnum = { type: ['number', 'null'] } as const;

const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const DOC_TYPES = ['boarding_pass', 'airfare_receipt', 'hotel_receipt', 'hotel_folio', 'hotel_receipt_and_folio', 'other'] as const;
export const ITEM_CATEGORIES = ['fare', 'airport_tax', 'addon', 'room', 'other'] as const;

export const DOCUMENT_SCHEMA = obj({
  doc_type: { type: 'string', enum: DOC_TYPES },
  pages: { type: 'array', items: { type: 'integer' }, description: 'Page numbers (1-based) that belong to this document.' },
  issuer_name: str,
  issuer_tax_id: nstr,
  billed_to_name: nstr,
  billed_to_tax_id: nstr,
  receipt_no: nstr,
  receipt_date: { ...nstr, description: 'YYYY-MM-DD in the Common Era. Convert Buddhist Era years by subtracting 543.' },
  currency: { ...str, description: 'ISO code, usually THB.' },
  total_amount: { ...nnum, description: 'Grand total actually paid, in currency units.' },
  vat_amount: nnum,
  line_items: {
    type: 'array',
    items: obj({
      description: str,
      amount: num,
      category: { type: 'string', enum: ITEM_CATEGORIES },
    }),
  },
  passenger_or_guest_name: nstr,
  flight: {
    anyOf: [
      obj({
        carrier: { ...str, description: 'Two-letter airline code, e.g. FD.' },
        flight_no: { ...str, description: 'Digits only, without the carrier code.' },
        booking_ref: { ...str, description: 'PNR / booking reference.' },
        from_iata: str,
        to_iata: str,
        date: { ...str, description: 'Flight date, YYYY-MM-DD, Common Era.' },
        boarding_time: { ...nstr, description: 'HH:MM, 24-hour. Only if printed.' },
        departure_time: { ...nstr, description: 'HH:MM, 24-hour. Only if printed as departure time.' },
        arrival_time: { ...nstr, description: 'HH:MM, 24-hour. Only if printed.' },
      }),
      { type: 'null' },
    ],
  },
  stay: {
    anyOf: [
      obj({
        check_in: { ...str, description: 'YYYY-MM-DD, Common Era.' },
        check_out: { ...str, description: 'YYYY-MM-DD, Common Era.' },
        nights: { type: 'integer' },
        room_no: nstr,
      }),
      { type: 'null' },
    ],
  },
  handwritten_notes: { ...nstr, description: 'Any handwritten text, e.g. "เบิกจ่ายเพียง 4,500 บาท", verbatim.' },
  evidence: {
    type: 'array',
    description: 'One entry for every number and date you report: the field path, the page, and the text exactly as printed.',
    items: obj({ field: str, page: { type: 'integer' }, quote: str }),
  },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  problems: { type: 'array', items: str, description: 'Anything unreadable or ambiguous. Report here instead of guessing.' },
});

export const FILE_SCHEMA = obj({
  documents: {
    type: 'array',
    description: 'Every document in the file, in page order. A receipt, each boarding pass and a folio are separate documents.',
    items: DOCUMENT_SCHEMA,
  },
});
