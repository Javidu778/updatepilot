type Props = {
  title: string;
  summary: string;
  /** When the real page is built, from the project plan. */
  builtIn: string;
  planned: string[];
};

/** Honest placeholder for sections that are not built yet. No fake data, no dead buttons. */
export function PlaceholderPage({ title, summary, builtIn, planned }: Props) {
  return (
    <>
      <div className="page-header">
        <h1>{title}</h1>
        <p className="muted">{summary}</p>
      </div>
      <section className="card" aria-labelledby="placeholder-heading">
        <h2 id="placeholder-heading">Not built yet</h2>
        <p>This page is part of the application shell. It will be built in {builtIn}.</p>
        <p className="muted">Planned:</p>
        <ul className="planned-list">
          {planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
