/**
 * The designed upgrade prompt (M3): rendered whenever a plan limit or a
 * feature gate is hit. Blackline language — a ruled notice block with the
 * tier ladder, never a raw error. Pure presentational; works in server and
 * client components.
 */
import type { PlanId } from '@claimwatch/core';
import { PLANS, PLAN_ORDER } from '@claimwatch/core';

export interface UpgradePromptProps {
  readonly title: string;
  /** One factual sentence about the limit/gate that was hit. */
  readonly detail: string;
  readonly currentPlan: PlanId | null;
  readonly suggestedPlan: PlanId | null;
}

const TIER_NOTES: Readonly<Record<PlanId, string>> = {
  startup: '1 watchlist · 10 competitors · 10 CPC classes',
  pro: '5 watchlists · litigation dockets · counsel-ready export',
  firm: 'multi-client workspaces · white-label briefs · +$99/workspace/mo',
};

function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

export function UpgradePrompt({ title, detail, currentPlan, suggestedPlan }: UpgradePromptProps) {
  return (
    <aside className="upgrade-prompt" role="status" aria-label="Plan upgrade required">
      <p className="upgrade-kicker">Plan limit</p>
      <h3>{title}</h3>
      <p className="upgrade-detail">{detail}</p>
      <ul className="tier-ladder">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = planId === currentPlan;
          const isSuggested = planId === suggestedPlan;
          return (
            <li
              key={planId}
              className="tier"
              data-current={isCurrent || undefined}
              data-suggested={isSuggested || undefined}
            >
              <span className="tier-name">
                {plan.label}
                {isCurrent ? <em> — your plan</em> : null}
                {isSuggested ? <em> — covers this</em> : null}
              </span>
              <span className="tier-price">
                {formatUsd(plan.monthlyUsd)}/mo
                <small>
                  {' '}
                  or {formatUsd(plan.annualUsd)}/yr — 2 months free billed annually
                </small>
              </span>
              <span className="tier-note">{TIER_NOTES[planId]}</span>
            </li>
          );
        })}
      </ul>
      <p className="upgrade-footnote">
        Nothing is deleted on any plan change: watchlists beyond a lower limit freeze read-only
        and thaw on upgrade.
      </p>
    </aside>
  );
}
