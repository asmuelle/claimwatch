'use client';

/**
 * Watchlist create/edit form. Client component: useActionState drives the
 * server action and renders validation issues inline and the designed
 * upgrade prompt on a plan-limit hit.
 */
import type { PlanId } from '@claimwatch/core';
import { useActionState } from 'react';
import { UpgradePrompt } from '../../components/UpgradePrompt';
import { limitCopy } from '../../lib/limitCopy';
import type { WatchlistFormState } from './actions';
import { createWatchlistAction, updateWatchlistAction } from './actions';

export interface WatchlistFormDefaults {
  readonly name: string;
  readonly claimSpaceDescription: string;
  readonly cpcPrefixes: string;
  readonly competitors: string;
}

export interface WatchlistFormProps {
  readonly mode: 'create' | 'edit';
  readonly orgSlug: string;
  readonly currentPlan: PlanId | null;
  readonly watchlistId?: string;
  readonly defaults?: WatchlistFormDefaults;
}

const IDLE: WatchlistFormState = { status: 'idle' };

const EMPTY_DEFAULTS: WatchlistFormDefaults = {
  name: '',
  claimSpaceDescription: '',
  cpcPrefixes: '',
  competitors: '',
};

export function WatchlistForm({
  mode,
  orgSlug,
  currentPlan,
  watchlistId,
  defaults = EMPTY_DEFAULTS,
}: WatchlistFormProps) {
  const action = mode === 'create' ? createWatchlistAction : updateWatchlistAction;
  const [state, formAction, pending] = useActionState(action, IDLE);

  return (
    <form className="watchlist-form" action={formAction}>
      <input type="hidden" name="org" value={orgSlug} />
      {watchlistId ? <input type="hidden" name="watchlistId" value={watchlistId} /> : null}

      <div className="field">
        <label htmlFor="name">Watchlist name</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={defaults.name}
          placeholder="Efficient neural inference"
        />
      </div>

      <div className="field">
        <label htmlFor="claimSpaceDescription">Claim-space description</label>
        <textarea
          id="claimSpaceDescription"
          name="claimSpaceDescription"
          required
          rows={3}
          defaultValue={defaults.claimSpaceDescription}
          placeholder="Describe the technology claim space in plain language — it seeds screening (min 20 characters)."
        />
      </div>

      <div className="field">
        <label htmlFor="cpcPrefixes">CPC classes</label>
        <input
          id="cpcPrefixes"
          name="cpcPrefixes"
          type="text"
          required
          defaultValue={defaults.cpcPrefixes}
          placeholder="G06N, H04L9/40"
        />
        <p className="field-hint">Comma-separated CPC symbols, e.g. G06N or H04L9/40.</p>
      </div>

      <div className="field">
        <label htmlFor="competitors">Named competitors</label>
        <textarea
          id="competitors"
          name="competitors"
          rows={3}
          defaultValue={defaults.competitors}
          placeholder={'Vektor Cognition, Inc.\nTessellate Compute Ltd.'}
        />
        <p className="field-hint">
          One per line. Named competitors always surface — they bypass screening.
        </p>
      </div>

      <button type="submit" disabled={pending}>
        {mode === 'create' ? 'Create watchlist' : 'Save changes'}
      </button>

      {state.status === 'saved' ? (
        <p className="form-saved" role="status">
          Saved “{state.watchlistName}”.
        </p>
      ) : null}

      {state.status === 'invalid' ? (
        <ul className="form-issues" role="alert">
          {state.issues.map((issue, index) => (
            <li key={index}>
              <strong>{issue.path}</strong>: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === 'limit' ? (
        <UpgradePrompt
          {...limitCopy(state.hit)}
          currentPlan={state.plan}
          suggestedPlan={state.hit.suggestedPlan}
        />
      ) : null}

      {state.status === 'no-entitlement' ? (
        <UpgradePrompt
          title="No active subscription"
          detail="This workspace has no entitled plan — pick a tier to manage watchlists."
          currentPlan={currentPlan}
          suggestedPlan="startup"
        />
      ) : null}
    </form>
  );
}
