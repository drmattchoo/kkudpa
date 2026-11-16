// Shared types between side panel, service worker, content script and rules engine.

export type DocType =
  | 'boarding_pass'
  | 'airfare_receipt'
  | 'hotel_receipt'
  | 'hotel_folio'
  | 'hotel_receipt_and_folio'
  | 'other';

export type LineItemCategory = 'fare' | 'airport_tax' | 'addon' | 'room' | 'other';

export interface Evidence {
  field: string;
  page: number;
  quote: string;
}

/** What the model returns for one file (spec §6). Dates are CE ISO strings. */
export interface ExtractedDocument {
  doc_type: DocType;
  pages: number[];
  issuer_name: string;
  issuer_tax_id: string | null;
  billed_to_name: string | null;
  billed_to_tax_id: string | null;
  receipt_no: string | null;
  receipt_date: string | null;
  currency: string;
  total_amount: number | null;
  vat_amount: number | null;
  line_items: { description: string; amount: number; category: LineItemCategory }[];
  passenger_or_guest_name: string | null;
  flight: {
    carrier: string;
    flight_no: string;
    booking_ref: string;
    from_iata: string;
    to_iata: string;
    date: string;
    boarding_time: string | null;
    departure_time: string | null;
    arrival_time: string | null;
  } | null;
  stay: { check_in: string; check_out: string; nights: number; room_no: string | null } | null;
  handwritten_notes: string | null;
  evidence: Evidence[];
  confidence: 'high' | 'medium' | 'low';
  problems: string[];
}

export interface SignatureInfo {
  signed: boolean;
  signatures: {
    signerName: string | null;
    signingTime: string | null;
    /** true when the signed byte range reaches the end of the file */
    coversWholeFile: boolean;
  }[];
  error?: string;
}

/**
 * A signed PDF the user dropped, held in memory for the session. One file is the
 * evidence for one claim line and may hold several documents (e.g. an airfare
 * receipt and both boarding passes, or a hotel receipt and its folio).
 */
export interface IngestedFile {
  id: string;
  name: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  size: number;
  sha256: string;
  signature: SignatureInfo | null;
  /** Every document found in the file, in page order. null until read. */
  documents: ExtractedDocument[] | null;
  extractionModel?: string;
  extractionError?: string;
}

/** One document inside a file. The rules engine works on these. */
export type DocUnit = Omit<IngestedFile, 'documents'> & { extracted: ExtractedDocument };

export function docUnits(files: IngestedFile[]): DocUnit[] {
  return files.flatMap(({ documents, ...f }) => (documents ?? []).map((extracted) => ({ ...f, extracted })));
}

/** Read from the trip form. Dates are CE ISO yyyy-mm-dd. Money in THB. */
export interface TripContext {
  tripNo: string | null;
  departDate: string | null;
  startDate: string | null;
  endDate: string | null;
  returnDate: string | null;
  province: string | null;
  workLocation: string | null;
  purpose: string | null;
  estimate: {
    perDiem: number | null;
    hotel: number | null;
    vehicle: number | null;
    other: number | null;
    requested: number | null;
  };
  traveller: {
    name: string | null;
    entitlement: string | null;
    perDiemRate: number | null;
    roomType: string | null;
    roomRate: number | null;
  } | null;
  financeNotes: { actor: string; action: string; comment: string; when: string }[];
  summaryClaimed: number | null;
}

export interface ClaimRow {
  name: string;
  item: string;
  evidence: string;
  signedBy: string;
  days: number | null;
  nights: number | null;
  amount: number | null;
  times: string;
}

export type ClaimKind = 'per_diem' | 'hotel' | 'airfare';

export interface Trace {
  /** What this number is, e.g. "receipt total" */
  label: string;
  value: string;
  /** Source: a file + page + printed text, or a DPA field */
  source:
    | { kind: 'document'; fileId: string; fileName: string; page: number; quote: string }
    | { kind: 'dpa'; field: string }
    | { kind: 'user'; note: string }
    | { kind: 'rule'; rule: string };
}

export type FlagLevel = 'block' | 'warn' | 'info';

export interface Flag {
  level: FlagLevel;
  rule: string;
  /** Rule text shown to the user when the rule fires (spec §4) */
  message: string;
  lineId?: string;
}

/** Times are BE strings in DPA format dd-MM-yyyy HH:mm. */
export interface PlannedTimes {
  depart: string;
  start: string;
  end: string;
  return: string;
}

export interface PlannedLine {
  id: string;
  kind: ClaimKind;
  category: string;
  item: string;
  times: PlannedTimes;
  /** per diem */
  days?: number;
  ratePerDay?: number;
  /** hotel */
  nights?: number;
  ratePerNight?: number;
  /** what DPA should compute (per diem, hotel) or what we type (airfare) */
  amount: number;
  note: string;
  /** ids of files to attach. Must end up as exactly one PDF. Empty for per diem. */
  evidenceFileIds: string[];
  traces: Trace[];
  confirmed: boolean;
  /** Same item and amount already in DPA's claim table: do not add (spec §2 rule 4) */
  duplicate?: boolean;
}

export interface Plan {
  lines: PlannedLine[];
  flags: Flag[];
  totals: { planned: number; existing: number; requested: number | null };
}

export interface Settings {
  /** The person's own KKU GenAI (IntelSphere) API key */
  apiKey: string;
  /** Model id on the KKU GenAI gateway */
  model: string;
  /** Optional model that re-reads a file when the first is unsure or fails */
  secondModel: string;
  /** Send page images (needed for scans). Off = text layer only. */
  sendImages: boolean;
  /** Longest side of each page image, in pixels */
  imageMaxPx: number;
  departOffsetMin: number;
  returnOffsetMin: number;
  /** Default flight time when a boarding pass prints no arrival time */
  defaultFlightMin: number;
  workStartTime: string;
  workEndTime: string;
  unitName: string;
  unitTaxId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'gemini-3.8-flash',
  secondModel: '',
  sendImages: true,
  imageMaxPx: 1600,
  departOffsetMin: -120,
  returnOffsetMin: 60,
  defaultFlightMin: 75,
  workStartTime: '08:30',
  workEndTime: '16:30',
  unitName: 'มหาวิทยาลัยขอนแก่น',
  unitTaxId: '',
};
