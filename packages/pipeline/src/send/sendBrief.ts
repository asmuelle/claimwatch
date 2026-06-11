/**
 * The M2 hard send-gate (DESIGN.md M2, product invariant 2).
 *
 * A brief without `validatedAt` CANNOT send: the gate pages the operator and
 * throws — it never degrades silently and never strips the failing content
 * to squeak through. Email delivery stays behind the BriefSender interface
 * (Resend in production, a deterministic mock in tests — no API key).
 */
import type { Brief } from '@claimwatch/core';

export interface BriefSendRequest {
  readonly to: string;
  readonly subject: string;
  readonly brief: Brief;
}

export interface BriefSendReceipt {
  readonly messageId: string;
}

/** Resend-class delivery boundary (TOOLS.md: RESEND_API_KEY in production). */
export interface BriefSender {
  send(request: BriefSendRequest): Promise<BriefSendReceipt>;
}

export interface SendIncident {
  readonly reason: 'validation-incomplete';
  readonly watchlistName: string;
  readonly weekOf: string;
  readonly droppedSentenceCount: number;
  readonly policyViolationCount: number;
}

/** Operator alerting boundary — a blocked send is an incident, not a log line. */
export interface OperatorPager {
  page(incident: SendIncident): void;
}

export class SendBlockedError extends Error {
  constructor(readonly incident: SendIncident) {
    super(
      `brief for "${incident.watchlistName}" (week of ${incident.weekOf}) is not validated — ` +
        `send blocked (${incident.droppedSentenceCount} dropped sentence(s), ` +
        `${incident.policyViolationCount} policy violation(s)); operator paged`,
    );
    this.name = 'SendBlockedError';
  }
}

export interface SendBriefInput {
  readonly brief: Brief;
  readonly to: string;
  readonly sender: BriefSender;
  readonly pager: OperatorPager;
}

/**
 * Sends a brief ONLY when `validatedAt` is set. Otherwise pages the operator
 * and throws SendBlockedError — the failure is loud by construction.
 */
export async function sendValidatedBrief(input: SendBriefInput): Promise<BriefSendReceipt> {
  const { brief } = input;
  if (brief.validatedAt === null) {
    const incident: SendIncident = {
      reason: 'validation-incomplete',
      watchlistName: brief.watchlistName,
      weekOf: brief.weekOf,
      droppedSentenceCount: brief.droppedSentenceCount,
      policyViolationCount: brief.policyViolationCount,
    };
    input.pager.page(incident);
    throw new SendBlockedError(incident);
  }
  return input.sender.send({
    to: input.to,
    subject: `ClaimWatch brief — ${brief.watchlistName}, week of ${brief.weekOf}`,
    brief,
  });
}

/** Deterministic test double standing in for the Resend client. */
export class MockBriefSender implements BriefSender {
  private readonly requests: BriefSendRequest[] = [];

  async send(request: BriefSendRequest): Promise<BriefSendReceipt> {
    this.requests.push(request);
    return { messageId: `mock-message-${this.requests.length}` };
  }

  get sent(): readonly BriefSendRequest[] {
    return [...this.requests];
  }
}

/** Records pages instead of paging anyone. */
export class RecordingPager implements OperatorPager {
  private readonly pages: SendIncident[] = [];

  page(incident: SendIncident): void {
    this.pages.push(incident);
  }

  get incidents(): readonly SendIncident[] {
    return [...this.pages];
  }
}
