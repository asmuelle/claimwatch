/**
 * Resend email adapter for the validated-brief send path (M4).
 *
 * Config-gated on RESEND_API_KEY via createBriefSender (absent -> the
 * deterministic MockBriefSender). The M2 send-gate sits IN FRONT of this
 * adapter by call order: sendValidatedBrief throws SendBlockedError before
 * BriefSender.send is ever invoked for an unvalidated brief — proven by the
 * zero-HTTP-calls test. This adapter cannot be reached with uncited content.
 */
import type { Brief } from '@claimwatch/core';
import type { BriefSender, BriefSendReceipt, BriefSendRequest } from './sendBrief';
import { MockBriefSender } from './sendBrief';

export const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'ClaimWatch Briefs <briefs@claimwatch.dev>';

export class ResendApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Resend API error (HTTP ${status}): ${detail}`);
    this.name = 'ResendApiError';
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Plain-text rendering of a validated brief (kept sentences + facts). */
export function renderBriefText(brief: Brief): string {
  const lines: string[] = [
    `ClaimWatch brief — ${brief.watchlistName}, week of ${brief.weekOf}`,
    '',
  ];
  for (const item of brief.items) {
    lines.push(`* ${item.fact.headline}`);
    for (const validation of item.sentences) {
      if (validation.kept) lines.push(`  ${validation.sentence.text}`);
    }
  }
  if (brief.quietWeek) lines.push('Quiet week: no in-scope changes observed.');
  lines.push('');
  lines.push(`Coverage — watched: ${brief.coverage.watched.join('; ')}`);
  lines.push(`Coverage — NOT watched: ${brief.coverage.notWatched.join('; ')}`);
  lines.push('');
  lines.push(brief.disclaimer);
  return lines.join('\n');
}

/** Minimal deterministic HTML rendering (blackline styling lives in-app). */
export function renderBriefHtml(brief: Brief): string {
  const items = brief.items
    .map((item) => {
      const kept = item.sentences
        .filter((validation) => validation.kept)
        .map((validation) => `<p>${escapeHtml(validation.sentence.text)}</p>`)
        .join('');
      return `<li><strong>${escapeHtml(item.fact.headline)}</strong>${kept}</li>`;
    })
    .join('');
  return (
    `<h1>ClaimWatch brief — ${escapeHtml(brief.watchlistName)}, week of ${escapeHtml(brief.weekOf)}</h1>` +
    `<ul>${items}</ul>` +
    `<p>Coverage — watched: ${escapeHtml(brief.coverage.watched.join('; '))}</p>` +
    `<p>Coverage — NOT watched: ${escapeHtml(brief.coverage.notWatched.join('; '))}</p>` +
    `<p><em>${escapeHtml(brief.disclaimer)}</em></p>`
  );
}

export interface ResendSenderOptions {
  readonly apiKey: string;
  readonly from?: string;
  readonly fetchImpl?: typeof fetch;
}

/** Real Resend delivery behind the BriefSender seam. */
export class ResendBriefSender implements BriefSender {
  private readonly fetchImpl: typeof fetch;
  private readonly from: string;

  constructor(private readonly options: ResendSenderOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('ResendBriefSender requires a non-empty API key (RESEND_API_KEY)');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.from = options.from ?? DEFAULT_FROM;
  }

  async send(request: BriefSendRequest): Promise<BriefSendReceipt> {
    const response = await this.fetchImpl(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [request.to],
        subject: request.subject,
        html: renderBriefHtml(request.brief),
        text: renderBriefText(request.brief),
      }),
    });
    if (!response.ok) {
      throw new ResendApiError(response.status, await response.text());
    }
    const payload = (await response.json()) as { readonly id?: unknown };
    if (typeof payload.id !== 'string' || payload.id === '') {
      throw new ResendApiError(response.status, 'response missing message id');
    }
    return { messageId: payload.id };
  }
}

type EnvShape = Readonly<Record<string, string | undefined>>;

/**
 * Config gate for the send seam: RESEND_API_KEY absent (all dev/test/CI in
 * this repo) -> deterministic mock; present -> real Resend adapter.
 * BRIEF_FROM_EMAIL optionally overrides the from address.
 */
export function createBriefSender(env: EnvShape, fetchImpl?: typeof fetch): BriefSender {
  const apiKey = env['RESEND_API_KEY']?.trim();
  if (!apiKey) {
    return new MockBriefSender();
  }
  const from = env['BRIEF_FROM_EMAIL']?.trim();
  return new ResendBriefSender({ apiKey, from: from ? from : undefined, fetchImpl });
}
