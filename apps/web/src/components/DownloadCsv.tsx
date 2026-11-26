'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api/config';

/**
 * Downloads a CSV from the API.
 *
 * A plain link would navigate away from the app, so the file is fetched with the session cookie and
 * handed to the browser as a blob. The file name comes from the server's Content-Disposition header,
 * which keeps the two sides in step.
 */
export function DownloadCsv({
  path,
  label,
  fallbackName,
}: {
  /** API path including any query string, for example /api/v1/exports/applications.csv?q=git */
  path: string;
  label: string;
  fallbackName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });

      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Your session ended. Sign in again to export.'
            : response.status === 429
              ? 'Too many exports. Try again later.'
              : `The export failed (${response.status}).`,
        );
        return;
      }

      const text = await response.text();
      const fromHeader = /filename="([^"]+)"/.exec(
        response.headers.get('content-disposition') ?? '',
      )?.[1];

      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fromHeader ?? fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="download-csv">
      <button type="button" className="btn btn-ghost" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : label}
      </button>
      {error ? (
        <span className="form-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
