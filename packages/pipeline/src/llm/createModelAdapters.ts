/**
 * Model adapter factory — the config gate for the model seam (M4).
 *
 * ANTHROPIC_API_KEY absent (every dev, test, and CI environment in this
 * repo): the deterministic mocks. Present: the real Messages API adapters.
 * The key is read from the environment only — never hardcoded, never logged.
 *
 * Either way the SAME downstream gates run: the citation validator and the
 * banned-phrase lint in assembleBrief see adapter output and mock output
 * identically (provider-independence is proven by test).
 */
import type { WatchlistConfig } from '../triage/watchlist';
import {
  AnthropicMessagesClient,
  AnthropicRelevanceClassifier,
  AnthropicBriefSynthesizer,
} from './anthropic';
import { MockBriefSynthesizer, MockRelevanceClassifier } from './mocks';
import type { BriefSynthesizer, RelevanceClassifier } from './types';

type EnvShape = Readonly<Record<string, string | undefined>>;

export interface ModelAdapterSet {
  readonly provider: 'mock' | 'anthropic';
  readonly classifier: RelevanceClassifier;
  readonly synthesizer: BriefSynthesizer;
}

export interface ModelAdapterOptions {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export function createModelAdapters(
  env: EnvShape,
  watchlist: WatchlistConfig,
  options: ModelAdapterOptions = {},
): ModelAdapterSet {
  const apiKey = env['ANTHROPIC_API_KEY']?.trim();
  if (!apiKey) {
    return {
      provider: 'mock',
      classifier: new MockRelevanceClassifier(watchlist.claimSpaceTerms),
      synthesizer: new MockBriefSynthesizer(),
    };
  }
  const client = new AnthropicMessagesClient({
    apiKey,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
  });
  return {
    provider: 'anthropic',
    classifier: new AnthropicRelevanceClassifier(client),
    synthesizer: new AnthropicBriefSynthesizer(client),
  };
}
