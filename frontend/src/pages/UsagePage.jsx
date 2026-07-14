import { useEffect, useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { getUsageSummary } from "@/lib/api"
import { toast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"

// Categorical pair validated against this app's dark card surface (#15121d)
// via the dataviz skill's validator - worst-case CVD separation 69.8 ΔE,
// well clear of the 12 floor. Fixed order (vision=slot 1, browsing=slot 2),
// never cycled or reassigned per-render.
const VISION_COLOR = "#3987e5"
const BROWSING_COLOR = "#199e70"

function formatUsd(value) {
  const n = Number(value) || 0
  // Most individual days/totals here are a few cents at most - 2 decimals
  // would round small-but-real spend down to "$0.00", which defeats the
  // point of a cost dashboard.
  const decimals = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2
  return `$${n.toFixed(decimals)}`
}

function formatShortDate(isoDate) {
  const [, month, day] = isoDate.split("-")
  return `${Number(month)}/${Number(day)}`
}

function StatCard({ label, value, loading }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className="mt-1 text-2xl font-semibold text-foreground">{formatUsd(value)}</p>
      )}
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null

  const vision = payload.find((p) => p.dataKey === "vision")?.value ?? 0
  const browsing = payload.find((p) => p.dataKey === "browsing")?.value ?? 0

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-popover-foreground">{label}</p>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2 rounded-full" style={{ backgroundColor: VISION_COLOR }} />
        Vision <span className="ml-auto text-popover-foreground">{formatUsd(vision)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2 rounded-full" style={{ backgroundColor: BROWSING_COLOR }} />
        Browsing <span className="ml-auto text-popover-foreground">{formatUsd(browsing)}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5 font-medium text-popover-foreground">
        <span>Total</span>
        {formatUsd(vision + browsing)}
      </div>
    </div>
  )
}

export function UsagePage() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getUsageSummary()
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch((err) => {
        if (!cancelled) {
          toast({ variant: "destructive", title: "Couldn't load usage data", description: err.message })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const totals = summary?.totals
  const daily = summary?.daily ?? []
  const chartData = daily.map((d) => ({ ...d, label: formatShortDate(d.date) }))

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-10 md:px-6">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Usage</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            OpenAI spend for screen-share vision calls and the web-browsing tool.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Today" value={totals?.today} loading={loading} />
          <StatCard label="This week" value={totals?.week} loading={loading} />
          <StatCard label="This month" value={totals?.month} loading={loading} />
          <StatCard label="All time" value={totals?.allTime} loading={loading} />
        </div>

        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <p className="mb-4 text-sm font-medium text-foreground">Daily spend, last 30 days</p>

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.every((d) => d.total === 0) ? (
            <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              No usage yet - trigger a screen share or a web-browsing question to see data here.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barCategoryGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={{ stroke: "var(--border)" }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v) => formatUsd(v)}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)" }} />
                <Legend
                  formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                  iconType="circle"
                  iconSize={8}
                />
                <Bar dataKey="vision" name="Vision" stackId="cost" fill={VISION_COLOR} radius={[0, 0, 0, 0]} />
                <Bar dataKey="browsing" name="Browsing" stackId="cost" fill={BROWSING_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}
