export default function UsageSkeleton() {
  // Mirrors the page shape: control bar, stats band, charts row, heatmap,
  // tables. animate-pulse only — no JS animation.
  return (
    <div className="space-y-6" aria-busy="true" data-testid="usage-skeleton">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-8 w-36 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="animate-pulse rounded-xl border bg-muted/40 p-5">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2 space-y-3">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-9 w-40 rounded bg-muted" />
            <div className="h-4 w-52 rounded bg-muted" />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-3">
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="h-7 w-24 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-xl border bg-muted/40 lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-xl border bg-muted/40" />
      </div>
      <div className="h-36 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  )
}
