// Messages between side panel, service worker and content script.
import type { ClaimRow, ExtractedDocument, PlannedLine, TripContext } from './types';
import type { FillReport, FillStep } from '../content/driver';
import type { SelfTestItem } from '../content/reader';

export type ContentRequest =
  | { type: 'ping' }
  | { type: 'read-context' }
  | { type: 'self-test' }
  | { type: 'list-item-options'; category: string }
  | { type: 'fill-line'; line: PlannedLine; add: boolean; evidence?: { base64: string; filename: string } }
  | { type: 'clear-panel' };

export type ContentResponse =
  | { ok: true; type: 'pong'; url: string; isTripForm: boolean }
  | { ok: true; type: 'context'; ctx: TripContext; rows: ClaimRow[]; selfTest: SelfTestItem[] }
  | { ok: true; type: 'self-test'; items: SelfTestItem[] }
  | { ok: true; type: 'options'; options: string[] }
  | { ok: true; type: 'fill-report'; report: FillReport }
  | { ok: true; type: 'done' }
  | { ok: false; error: string };

/** Sent by the content script while filling. */
export type ContentEvent =
  | { type: 'fill-step'; lineId: string; step: FillStep }
  | { type: 'manual-attach-needed'; lineId: string; filename: string };

export type WorkerRequest = {
  type: 'extract';
  file: { name: string; mime: 'application/pdf' | 'image/jpeg' | 'image/png'; base64: string };
};

export type WorkerResponse =
  | { ok: true; docs: ExtractedDocument[]; model: string; attempts: { model: string; outcome: string }[] }
  | { ok: false; error: string };
