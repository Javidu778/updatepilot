import type { Metadata } from 'next';

// The title template in layout.tsx does not apply to the page in the same route segment, so this one is absolute.
export const metadata: Metadata = { title: { absolute: 'Overview | UpdatePilot' } };

const METRICS = ['Applications', 'Updates available', 'Last scan', 'Agent'];

export default function OverviewPage() {
  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p className="muted">Summary of your applications, updates and agent connection.</p>
      </div>

      <dl className="metric-grid">
        {METRICS.map((label) => (
          <div key={label} className="card">
            <dt className="metric-label">{label}</dt>
            <dd className="metric-value">&mdash;</dd>
          </div>
        ))}
      </dl>

      <section className="card" aria-labelledby="getting-started">
        <h2 id="getting-started">Not built yet</h2>
        <p>
          This is the application shell. The overview fills with real scan data once an agent is
          paired (Week 3) and the dashboard is connected (Week 2).
        </p>
        <p className="muted">Planned:</p>
        <ul className="planned-list">
          <li>Application and update counts from the latest scan</li>
          <li>Last scan time and agent connection state</li>
          <li>Recent activity and clear next actions</li>
        </ul>
      </section>
    </>
  );
}
