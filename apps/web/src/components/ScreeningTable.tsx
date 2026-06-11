import type { ScreeningResultRow } from '@claimwatch/pipeline';

/** Recall-audit ledger: every screened document, including downranked rows. */
export function ScreeningTable({ results }: { readonly results: readonly ScreeningResultRow[] }) {
  return (
    <section aria-labelledby="screening-heading">
      <h2 id="screening-heading">Screening log</h2>
      <table>
        <caption>
          Every document this week keeps a logged screening result — models may downrank, never
          delete.
        </caption>
        <thead>
          <tr>
            <th scope="col">Document</th>
            <th scope="col">Matched by</th>
            <th scope="col">Score</th>
            <th scope="col">Verdict</th>
            <th scope="col">Decision</th>
            <th scope="col">Model</th>
            <th scope="col">Rationale</th>
          </tr>
        </thead>
        <tbody>
          {results.map((row) => (
            <tr key={row.id} data-decision={row.decision}>
              <td>{row.docId}</td>
              <td>{row.matchedBy.length > 0 ? row.matchedBy.join(' ∪ ') : '—'}</td>
              <td>{row.embeddingScore.toFixed(2)}</td>
              <td>{row.verdict}</td>
              <td className={`decision-${row.decision}`}>{row.decision}</td>
              <td>{row.model}</td>
              <td>{row.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
