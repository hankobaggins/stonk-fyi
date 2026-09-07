"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card p-8 text-center max-w-lg mx-auto mt-12">
      <h2 className="font-medium mb-2">Couldn&apos;t load data</h2>
      <p className="text-sm text-muted mb-4">
        The StonkFun API didn&apos;t respond as expected. It may be rate-limited or its shape may have changed.
      </p>
      <pre className="text-xs text-left font-mono text-secondary bg-surface-2 rounded-lg p-3 overflow-x-auto mb-4">{error.message}</pre>
      <button onClick={reset} className="text-sm px-3 py-1.5 rounded-lg border border-border-strong hover:bg-surface-2">
        Retry
      </button>
    </div>
  );
}
