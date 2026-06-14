/**
 * Real Anthropic adapter (M4): RelevanceClassifier + BriefSynthesizer over
 * the Messages API. Config-gated on ANTHROPIC_API_KEY via createModelAdapters
 * — the deterministic mocks remain the default everywhere.
 *
 * Trust-layer position (non-negotiable): this adapter only produces DRAFTS.
 * Its output flows through the same citation validator, banned-phrase lint,
 * and send-gate as mock output (synthesizeBrief -> assembleBrief). Nothing
 * here can mark a sentence valid, set validatedAt, or send email.
 *
 * - Request shapes are Batch-ready: buildClassifyParams/buildSynthesisParams
 *   produce plain Messages `params` objects; toBatchRequest wraps them in the
 *   `{ custom_id, params }` entry shape of POST /v1/messages/batches.
 * - Retries with backoff on HTTP 429 (rate limit) and 529 (overloaded),
 *   honoring Retry-After when present. Injectable sleep keeps tests instant.
 * - Refusals / unparseable output: the synthesizer returns UNCITED sentences
 *   (dropped by the cite-or-omit gate); the classifier falls back to a
 *   recall-biased 'adjacent' verdict (downrank-not-delete, invariant 3).
 */
import { z } from 'zod';
import type { BriefItemFact, CitationRef } from '@claimwatch/core';
import type { StoredDocument } from '../store/types';
import type {
  BriefSynthesizer,
  ClassifierVerdict,
  RelevanceClassifier,
  SynthesisDraft,
} from './types';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_MESSAGES_PATH = '/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Cost-ladder defaults (DESIGN.md): Haiku-class screening, Sonnet synthesis. */
export const DEFAULT_SCREENING_MODEL = 'claude-haiku-4-5';
export const DEFAULT_SYNTHESIS_MODEL = 'claude-sonnet-4-6';

const SCREENING_PROMPT_VERSION = 'screening-v1-anthropic';

export interface MessagesParams {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string;
  readonly messages: readonly { readonly role: 'user'; readonly content: string }[];
}

/** Entry shape for POST /v1/messages/batches (`requests` array element). */
export interface BatchRequestEntry {
  readonly custom_id: string;
  readonly params: MessagesParams;
}

/** Wraps Messages params in the Message Batches request-entry shape. */
export function toBatchRequest(customId: string, params: MessagesParams): BatchRequestEntry {
  return { custom_id: customId, params };
}

export class AnthropicApiError extends Error {
  constructor(
    readonly status: number,
    readonly attempts: number,
    detail: string,
  ) {
    super(`Anthropic API error (HTTP ${status}) after ${attempts} attempt(s): ${detail}`);
    this.name = 'AnthropicApiError';
  }
}

const messagesResponseSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
  stop_reason: z.string().nullable(),
  model: z.string(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export interface MessageResult {
  readonly text: string;
  readonly stopReason: string | null;
  readonly tokensUsed: number;
  readonly model: string;
}

export interface AnthropicClientOptions {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxRetries?: number;
  readonly baseUrl?: string;
}

const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const RETRYABLE_STATUSES = new Set([429, 529]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thin Messages API client: auth headers, retry/backoff, response parsing. */
export class AnthropicMessagesClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly url: string;

  constructor(private readonly options: AnthropicClientOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('AnthropicMessagesClient requires a non-empty API key (ANTHROPIC_API_KEY)');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.url = new URL(ANTHROPIC_MESSAGES_PATH, options.baseUrl ?? ANTHROPIC_BASE_URL).toString();
  }

  async create(params: MessagesParams): Promise<MessageResult> {
    let lastStatus = 0;
    let lastDetail = '';
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(params),
      });
      if (response.ok) {
        const parsed = messagesResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new AnthropicApiError(200, attempt, `unexpected response shape: ${parsed.error.message}`);
        }
        const text = parsed.data.content
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('');
        return {
          text,
          stopReason: parsed.data.stop_reason,
          tokensUsed: parsed.data.usage.input_tokens + parsed.data.usage.output_tokens,
          model: parsed.data.model,
        };
      }
      lastStatus = response.status;
      lastDetail = await response.text();
      if (!RETRYABLE_STATUSES.has(response.status) || attempt > this.maxRetries) {
        throw new AnthropicApiError(response.status, attempt, lastDetail);
      }
      await this.sleep(backoffMs(response.headers.get('retry-after'), attempt));
    }
    throw new AnthropicApiError(lastStatus, this.maxRetries + 1, lastDetail);
  }
}

/** Retry-After seconds when sent; exponential backoff otherwise. */
function backoffMs(retryAfterHeader: string | null, attempt: number): number {
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

const OBSERVATION_POLICY =
  'You are a patent-monitoring research assistant. You report observations only — ' +
  'never legal advice, never freedom-to-operate or infringement opinions. ' +
  'Respond with a single JSON object and nothing else.';

/** Builds the Haiku-class screening request (Batch-ready params). */
export function buildClassifyParams(
  doc: StoredDocument,
  claimSpaceDescription: string,
  model: string = DEFAULT_SCREENING_MODEL,
): MessagesParams {
  return {
    model,
    max_tokens: 300,
    system:
      `${OBSERVATION_POLICY} Classify whether a publication is relevant to a watchlist claim space. ` +
      'JSON shape: {"verdict":"in-scope"|"adjacent"|"out-of-scope","confidence":0..1,"rationale":"one line"}',
    messages: [
      {
        role: 'user',
        content:
          `Claim space: ${claimSpaceDescription}\n\n` +
          `Publication: ${doc.docId}\nTitle: ${doc.title}\nAssignee: ${doc.assignee}\n` +
          `CPC: ${doc.cpcCodes.join(', ') || '(none)'}\nPublished: ${doc.publicationDate}`,
      },
    ],
  };
}

/** Builds the Sonnet-class synthesis request (Batch-ready params). */
export function buildSynthesisParams(
  fact: BriefItemFact,
  model: string = DEFAULT_SYNTHESIS_MODEL,
): MessagesParams {
  const citation =
    fact.claimNumber !== undefined
      ? `(${fact.docId}, claim ${fact.claimNumber}, ${fact.publicationDate})`
      : `(${fact.docId}, ${fact.publicationDate})`;
  return {
    model,
    max_tokens: 600,
    system:
      `${OBSERVATION_POLICY} Draft brief sentences under cite-or-omit grounding: every sentence MUST ` +
      'end with its citation marker verbatim and list the same citation in the citations array. ' +
      'Cite ONLY the provided fact — uncited or mis-cited sentences are mechanically dropped. ' +
      'JSON shape: {"sentences":[{"text":"... ' +
      '(docId[, claim N], date)","citations":[{"docId":"...","claimNumber":N?,"date":"yyyy-mm-dd"}]}]}',
    messages: [
      {
        role: 'user',
        content:
          `Stored fact (the ONLY citable material):\n` +
          `kind: ${fact.kind}\nfamily: ${fact.familyId}\ndocId: ${fact.docId}\n` +
          `assignee: ${fact.assignee}\npublished: ${fact.publicationDate}\n` +
          (fact.claimNumber !== undefined ? `claim: ${fact.claimNumber}\n` : '') +
          (fact.change !== undefined ? `structural change: ${fact.change}\n` : '') +
          `deterministic headline: ${fact.headline}\n\n` +
          `Write 1-2 observation sentences. Required citation marker: ${citation}`,
      },
    ],
  };
}

const verdictSchema = z.object({
  verdict: z.enum(['in-scope', 'adjacent', 'out-of-scope']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

const citationRefSchema = z.object({
  docId: z.string().min(1),
  claimNumber: z.number().int().positive().optional(),
  date: z.string().min(1),
});

const sentencesSchema = z.object({
  sentences: z.array(
    z.object({ text: z.string().min(1), citations: z.array(citationRefSchema) }),
  ),
});

/** Extracts the first JSON object from model text (tolerates code fences). */
function tryParseJsonObject(text: string): unknown | undefined {
  const candidates = [text.trim()];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export interface AnthropicAdapterOptions {
  readonly model?: string;
}

/** Haiku-class screening over the Messages API. */
export class AnthropicRelevanceClassifier implements RelevanceClassifier {
  private readonly model: string;

  constructor(
    private readonly client: AnthropicMessagesClient,
    options: AnthropicAdapterOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_SCREENING_MODEL;
  }

  async classify(doc: StoredDocument, claimSpaceDescription: string): Promise<ClassifierVerdict> {
    const result = await this.client.create(
      buildClassifyParams(doc, claimSpaceDescription, this.model),
    );
    const parsed = verdictSchema.safeParse(tryParseJsonObject(result.text) ?? null);
    if (result.stopReason === 'refusal' || !parsed.success) {
      // Recall-biased fallback (invariant 3): an unusable verdict may only
      // downrank-not-delete, so the document SURFACES as 'adjacent' for human
      // review rather than being silently screened out.
      return {
        verdict: 'adjacent',
        confidence: 0,
        rationale:
          result.stopReason === 'refusal'
            ? 'model refused to classify — surfaced for human review (recall-biased fallback)'
            : 'model output failed verdict validation — surfaced for human review (recall-biased fallback)',
        tokensUsed: result.tokensUsed,
        model: result.model,
        promptVersion: SCREENING_PROMPT_VERSION,
      };
    }
    return {
      ...parsed.data,
      tokensUsed: result.tokensUsed,
      model: result.model,
      promptVersion: SCREENING_PROMPT_VERSION,
    };
  }
}

/** Sonnet-class synthesis over the Messages API. */
export class AnthropicBriefSynthesizer implements BriefSynthesizer {
  private readonly model: string;

  constructor(
    private readonly client: AnthropicMessagesClient,
    options: AnthropicAdapterOptions = {},
  ) {
    this.model = options.model ?? DEFAULT_SYNTHESIS_MODEL;
  }

  async draftSentences(fact: BriefItemFact): Promise<SynthesisDraft> {
    const result = await this.client.create(buildSynthesisParams(fact, this.model));
    const parsed = sentencesSchema.safeParse(tryParseJsonObject(result.text) ?? null);
    if (result.stopReason === 'refusal' || !parsed.success) {
      // Refusal / unparseable output -> a single UNCITED sentence. The
      // cite-or-omit gate drops it ('no-citation') and the brief item falls
      // back to the deterministic fact rendering. Never paraphrased here.
      return {
        sentences: [
          {
            text:
              result.stopReason === 'refusal'
                ? 'model refused to draft this item'
                : result.text.trim() || 'model returned no usable draft',
            citations: [],
          },
        ],
        tokensUsed: result.tokensUsed,
      };
    }
    const sentences = parsed.data.sentences.map((sentence) => ({
      text: sentence.text,
      citations: sentence.citations.map(
        (ref): CitationRef => ({
          docId: ref.docId,
          ...(ref.claimNumber !== undefined ? { claimNumber: ref.claimNumber } : {}),
          date: ref.date,
        }),
      ),
    }));
    return { sentences, tokensUsed: result.tokensUsed };
  }
}
