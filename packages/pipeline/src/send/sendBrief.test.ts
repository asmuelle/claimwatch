/**
 * M2 acceptance: "a seeded broken citation provably blocks a brief from
 * sending" — the gate is the stored `validatedAt` field, nothing softer.
 */
import { describe, expect, test } from 'vitest';
import { FaultInjectingSynthesizer, MockBriefSynthesizer } from '../llm/mocks';
import { runSlice } from '../runSlice';
import { USPTO_FIXTURES_DIR } from '../testSupport/fixtures';
import { MockBriefSender, RecordingPager, SendBlockedError, sendValidatedBrief } from './sendBrief';

const NOW = '2026-05-15T12:00:00.000Z';
const DEV_INBOX = 'briefs-dev@claimwatch.test';

describe('the hard send-gate (DESIGN.md M2, invariant 2)', () => {
  test('a fully validated brief sends and returns a receipt', async () => {
    const slice = await runSlice({ fixturesDir: USPTO_FIXTURES_DIR, nowIso: NOW });
    const sender = new MockBriefSender();
    const pager = new RecordingPager();

    const receipt = await sendValidatedBrief({ brief: slice.brief, to: DEV_INBOX, sender, pager });

    expect(receipt.messageId).toBe('mock-message-1');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe(DEV_INBOX);
    expect(sender.sent[0]?.subject).toContain(slice.brief.watchlistName);
    expect(pager.incidents).toHaveLength(0);
  });

  test('a seeded broken citation blocks the send and pages the operator', async () => {
    const corrupting = new FaultInjectingSynthesizer(
      new MockBriefSynthesizer(),
      (fact, sentences) =>
        fact.docId === 'US-12790881-B2'
          ? sentences.map((s) => ({
              ...s,
              citations: s.citations.map((c) => ({ ...c, date: '1999-01-01' })),
            }))
          : sentences,
    );
    const slice = await runSlice({
      fixturesDir: USPTO_FIXTURES_DIR,
      nowIso: NOW,
      synthesizer: corrupting,
    });
    expect(slice.brief.validatedAt).toBeNull();
    const sender = new MockBriefSender();
    const pager = new RecordingPager();

    await expect(
      sendValidatedBrief({ brief: slice.brief, to: DEV_INBOX, sender, pager }),
    ).rejects.toThrow(SendBlockedError);

    // Loud failure: nothing was sent, the operator was paged with the facts.
    expect(sender.sent).toHaveLength(0);
    expect(pager.incidents).toHaveLength(1);
    expect(pager.incidents[0]).toMatchObject({
      reason: 'validation-incomplete',
      watchlistName: slice.brief.watchlistName,
      weekOf: slice.brief.weekOf,
      droppedSentenceCount: 1,
    });
  });

  test('a banned-phrase policy violation also blocks the send', async () => {
    const opinionated = new FaultInjectingSynthesizer(
      new MockBriefSynthesizer(),
      (_fact, sentences) =>
        sentences.map((s) => ({
          ...s,
          text: `${s.text} This suggests freedom to operate in the space.`,
        })),
    );
    const slice = await runSlice({
      fixturesDir: USPTO_FIXTURES_DIR,
      nowIso: NOW,
      synthesizer: opinionated,
    });
    const sender = new MockBriefSender();
    const pager = new RecordingPager();

    await expect(
      sendValidatedBrief({ brief: slice.brief, to: DEV_INBOX, sender, pager }),
    ).rejects.toThrow(/send blocked/);

    expect(sender.sent).toHaveLength(0);
    expect(pager.incidents[0]?.policyViolationCount).toBeGreaterThan(0);
  });
});
