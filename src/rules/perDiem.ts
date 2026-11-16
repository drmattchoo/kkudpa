import type { ExtractedDocument, Settings, TripContext } from '../shared/types';
import { formatBeDateTime, isoToNaive, MINUTE } from '../shared/dates';

export interface PerDiemCount {
  days: number;
  /** Duration split as DPA shows it under รวมเวลาค่าเบี้ยเลี้ยง */
  d: number;
  h: number;
  m: number;
  totalMinutes: number;
}

/**
 * Reference rule (spec §4): every full 24 hours is one day, and a remainder over
 * 12 hours is one more day. Times are naive timestamps (ms).
 */
export function countPerDiemDays(departMs: number, returnMs: number): PerDiemCount {
  if (!(returnMs > departMs)) throw new Error('Return time must be after departure time');
  const totalMinutes = Math.round((returnMs - departMs) / MINUTE);
  const d = Math.floor(totalMinutes / 1440);
  const rem = totalMinutes - d * 1440;
  const days = d + (rem > 720 ? 1 : 0);
  return { days, d, h: Math.floor(rem / 60), m: rem % 60, totalMinutes };
}

export interface FlightLeg {
  fileId: string;
  fileName: string;
  date: string;
  boarding: string | null;
  departure: string | null;
  arrival: string | null;
  from: string;
  to: string;
  flightNo: string;
  bookingRef: string;
  evidencePage: number;
  /** naive ms of the best-known time on this leg, for ordering */
  sortKey: number;
}

export function flightLegs(files: { id: string; name: string; extracted: ExtractedDocument | null }[]): FlightLeg[] {
  const legs: FlightLeg[] = [];
  for (const f of files) {
    const x = f.extracted;
    if (!x || x.doc_type !== 'boarding_pass' || !x.flight?.date) continue;
    const fl = x.flight;
    const t = fl.departure_time ?? fl.boarding_time ?? '00:00';
    const ev = x.evidence.find((e) => /boarding|departure|time/i.test(e.field));
    legs.push({
      fileId: f.id,
      fileName: f.name,
      date: fl.date,
      boarding: fl.boarding_time,
      departure: fl.departure_time,
      arrival: fl.arrival_time,
      from: fl.from_iata,
      to: fl.to_iata,
      flightNo: `${fl.carrier ?? ''}${fl.flight_no ?? ''}`.trim(),
      bookingRef: fl.booking_ref ?? '',
      evidencePage: ev?.page ?? x.pages[0] ?? 1,
      sortKey: isoToNaive(fl.date, t),
    });
  }
  return legs.sort((a, b) => a.sortKey - b.sortKey);
}

export interface ProposedTimes {
  depart: string;
  start: string;
  end: string;
  return: string;
  /** How each default was derived, for the review screen */
  basis: { depart: string; return: string; start: string; end: string };
  fromFlights: boolean;
  outbound?: FlightLeg;
  inbound?: FlightLeg;
}

/**
 * Default times (spec §7.3): departure = outbound boarding time + departOffset
 * (default −2 h); return = inbound arrival + returnOffset (default +1 h), or inbound
 * boarding + default flight time + returnOffset when arrival is not printed.
 * Work start/end come from the DPA activity dates and the work-hours settings.
 * The user must confirm all four.
 */
export function proposeTimes(legs: FlightLeg[], ctx: TripContext, s: Settings): ProposedTimes {
  const startIso = ctx.startDate ?? ctx.departDate;
  const endIso = ctx.endDate ?? ctx.returnDate;
  const start = startIso ? isoToNaive(startIso, s.workStartTime) : null;
  const end = endIso ? isoToNaive(endIso, s.workEndTime) : null;

  let depart: number | null = null;
  let ret: number | null = null;
  let departBasis = '';
  let returnBasis = '';
  const outbound = legs[0];
  const inbound = legs.length > 1 ? legs[legs.length - 1] : undefined;

  if (outbound) {
    const t = outbound.boarding ?? outbound.departure;
    if (t) {
      depart = isoToNaive(outbound.date, t) + s.departOffsetMin * MINUTE;
      departBasis = `${outbound.flightNo} ${outbound.boarding ? 'boarding' : 'departure'} ${t} ${sign(s.departOffsetMin)}`;
    }
  }
  if (inbound) {
    if (inbound.arrival) {
      let arr = isoToNaive(inbound.date, inbound.arrival);
      const dep = inbound.departure ?? inbound.boarding;
      if (dep && arr < isoToNaive(inbound.date, dep)) arr += 1440 * MINUTE; // arrives after midnight
      ret = arr + s.returnOffsetMin * MINUTE;
      returnBasis = `${inbound.flightNo} arrival ${inbound.arrival} ${sign(s.returnOffsetMin)}`;
    } else {
      const t = inbound.boarding ?? inbound.departure;
      if (t) {
        ret = isoToNaive(inbound.date, t) + (s.defaultFlightMin + s.returnOffsetMin) * MINUTE;
        returnBasis = `${inbound.flightNo} ${inbound.boarding ? 'boarding' : 'departure'} ${t} + ${s.defaultFlightMin} min flight ${sign(s.returnOffsetMin)}`;
      }
    }
  }

  const fromFlights = depart != null && ret != null;
  if (depart == null) {
    depart = ctx.departDate ? isoToNaive(ctx.departDate, s.workStartTime) : (start ?? 0);
    departBasis = 'DPA วันที่ออกเดินทาง + work start (no outbound boarding pass)';
  }
  if (ret == null) {
    ret = ctx.returnDate ? isoToNaive(ctx.returnDate, s.workEndTime) : (end ?? depart);
    returnBasis = 'DPA วันที่เดินทางกลับ + work end (no inbound boarding pass)';
  }
  // Work cannot start before arrival or end after leaving.
  const st = start == null ? depart : Math.max(start, depart);
  const en = end == null ? ret : Math.min(end, ret);

  return {
    depart: formatBeDateTime(depart),
    start: formatBeDateTime(st),
    end: formatBeDateTime(en),
    return: formatBeDateTime(ret),
    basis: {
      depart: departBasis,
      return: returnBasis,
      start: `DPA วันที่เริ่มต้น + ${s.workStartTime}`,
      end: `DPA วันที่สิ้นสุด + ${s.workEndTime}`,
    },
    fromFlights,
    outbound,
    inbound,
  };
}

function sign(min: number): string {
  const h = Math.abs(min) / 60;
  const txt = Number.isInteger(h) ? `${h} h` : `${Math.abs(min)} min`;
  return `${min < 0 ? '−' : '+'} ${txt}`;
}
