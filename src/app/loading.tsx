// Route-level skeleton (2026-09-16): with the layout streaming, this is what paints at the TTFB while the page's
// server component waits on its upstreams. Generic on purpose (every route is a title, a KPI row and blocks) and
// height-matched to the home page's first screen so the swap does not jump. No numbers, no labels: nothing here
// may be mistaken for data.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="grid md:grid-cols-[1.2fr_1fr] gap-x-8 gap-y-5 items-end pb-1">
        <div className="order-2 md:order-1 space-y-3">
          <div className="skeleton h-3 w-56" />
          <div className="skeleton h-9 w-72" />
          <div className="skeleton h-3.5 w-[26rem] max-w-full" />
        </div>
        <div className="order-1 md:order-2 flex flex-col items-start md:items-end gap-2.5">
          <div className="skeleton h-12 w-44" />
          <div className="skeleton h-3 w-40" />
          <div className="skeleton h-11 w-full md:w-36 mt-1.5" />
        </div>
      </div>
      <div className="skeleton h-40 w-full" />
      <div className="skeleton h-2.5 w-full" />
      <div className="kpis gap-x-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[74px]" />)}
      </div>
      <div className="skeleton h-72 w-full" />
    </div>
  );
}
