"use client";

import Link from "next/link";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const minified = /Minified React error/.test(error.message);
  return (
    <div className="card p-8 text-center max-w-lg mx-auto mt-12">
      <h2 className="font-medium mb-2">Couldn&apos;t load this page</h2>
      <p className="text-sm text-muted mb-4">
        Something failed while fetching from an upstream API. Retry usually fixes it; if it keeps happening, the error id below helps track it down.
      </p>
      <pre className="text-xs text-left font-mono text-secondary bg-surface-2 rounded-lg p-3 overflow-x-auto mb-4">
        {minified ? "server render error" : error.message}
        {error.digest ? `\ndigest ${error.digest}` : ""}
      </pre>
      <div className="flex justify-center gap-3">
        <button onClick={reset} className="text-sm px-3 py-1.5 rounded-lg border border-border-strong hover:bg-surface-2">
          Retry
        </button>
        <Link href="/" className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 text-secondary">
          $STONK page
        </Link>
      </div>
    </div>
  );
}
