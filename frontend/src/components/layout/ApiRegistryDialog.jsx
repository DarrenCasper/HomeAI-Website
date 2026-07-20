import { useEffect, useState } from "react"
import { Loader2, Plus, X } from "lucide-react"

import {
  approveApi,
  bulkApproveEligibleApis,
  bulkDeleteApis,
  bulkEnableCategoryApis,
  createApi,
  deleteApi,
  getApis,
  getPendingApis,
  rejectApi,
  updateApi,
} from "@/lib/api"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// No date library in this project for something this small - just enough
// granularity to distinguish "just checked" from "this is stale."
function formatRelativeTime(dateStr) {
  if (!dateStr) return null
  const minutes = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// lastCheckOk is null until the scheduled health check (backend/src/lib/
// apiHealthCheck.js) has run at least once for this entry.
function HealthStatus({ api }) {
  if (api.lastCheckOk === null || api.lastCheckOk === undefined) {
    return <p className="text-[11px] text-muted-foreground">Not checked yet</p>
  }
  const timeAgo = formatRelativeTime(api.lastCheckedAt)
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span
        className={`size-1.5 shrink-0 rounded-full ${api.lastCheckOk ? "bg-emerald-500" : "bg-destructive"}`}
        aria-hidden="true"
      />
      {api.lastCheckOk ? "Healthy" : "Failing"}
      {timeAgo && ` · checked ${timeAgo}`}
    </p>
  )
}

const PAGE_SIZE = 15

// Compact page-number set: first, last, current, and one on each side of
// current - collapsed further into "1 ... 4 5 6 ... 23" by the ellipsis
// logic in Pagination below, rather than one button per page.
function getPageNumbers(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1])
  return [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
}

function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  const numbers = getPageNumbers(page, totalPages)

  const items = []
  let prev = 0
  for (const n of numbers) {
    if (n - prev > 1) items.push({ ellipsis: true, key: `ellipsis-${n}` })
    items.push({ ellipsis: false, page: n, key: n })
    prev = n
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-1 pt-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        Previous
      </Button>
      {items.map((item) =>
        item.ellipsis ? (
          <span key={item.key} className="px-1 text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <Button
            key={item.key}
            type="button"
            variant={item.page === page ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-7 px-0 text-xs"
            onClick={() => onChange(item.page)}
          >
            {item.page}
          </Button>
        )
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
      >
        Next
      </Button>
    </div>
  )
}

function CategoryFilter({ categories, value, onChange }) {
  if (categories.length === 0) return null
  return (
    <select
      className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All Categories</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )
}

const EMPTY_DRAFT = {
  name: "",
  description: "",
  baseUrl: "",
  path: "",
  method: "GET",
  params: [],
  authType: "none",
  authEnvVar: "",
  authKeyName: "",
  minIntervalMs: 350,
  skipHealthCheck: false,
  healthCheckParams: null,
}

// healthCheckParams is stored as a plain object ({ q: "Naruto" }), edited
// here as a name/value list - same row-editor visual style as ParamsEditor
// below, just name+value instead of the full name/in/required/description
// shape a real call param needs.
function pairsToParamsObject(pairs) {
  const obj = {}
  for (const [name, value] of pairs) {
    if (name.trim()) obj[name.trim()] = value
  }
  return Object.keys(obj).length ? obj : null
}

function HealthCheckParamsEditor({ value, onChange }) {
  const pairs = Object.entries(value || {})

  const updatePair = (i, field, val) => {
    const next = pairs.map((p) => [...p])
    next[i] = field === "name" ? [val, next[i][1]] : [next[i][0], val]
    onChange(pairsToParamsObject(next))
  }
  const removePair = (i) => onChange(pairsToParamsObject(pairs.filter((_, idx) => idx !== i)))
  const addPair = () => onChange(pairsToParamsObject([...pairs, ["", ""]]))

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Health check params</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={addPair}>
          <Plus className="size-3" />
          Add param
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Real values the scheduled health check calls this API with, e.g. q / Naruto. Leave empty to fall back to a
        plain reachability check instead.
      </p>
      {pairs.length === 0 && <p className="text-[11px] text-muted-foreground">No health check params</p>}
      {pairs.map(([name, val], i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            className="h-7 flex-1 text-xs"
            placeholder="name"
            value={name}
            onChange={(e) => updatePair(i, "name", e.target.value)}
          />
          <Input
            className="h-7 flex-1 text-xs"
            placeholder="value"
            value={val}
            onChange={(e) => updatePair(i, "value", e.target.value)}
          />
          <button
            type="button"
            onClick={() => removePair(i)}
            className="text-muted-foreground transition-colors hover:text-destructive"
          >
            <X className="size-3.5" />
            <span className="sr-only">Remove param</span>
          </button>
        </div>
      ))}
    </div>
  )
}

function ParamsEditor({ params, onChange }) {
  const updateParam = (i, field, value) => {
    const next = [...params]
    next[i] = { ...next[i], [field]: value }
    onChange(next)
  }
  const removeParam = (i) => onChange(params.filter((_, idx) => idx !== i))
  const addParam = () => onChange([...params, { name: "", in: "query", required: false, description: "" }])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Params</span>
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={addParam}>
          <Plus className="size-3" />
          Add param
        </Button>
      </div>
      {params.length === 0 && <p className="text-[11px] text-muted-foreground">No params</p>}
      {params.map((p, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            className="h-7 flex-1 text-xs"
            placeholder="name"
            value={p.name}
            onChange={(e) => updateParam(i, "name", e.target.value)}
          />
          <select
            className="h-7 rounded-md border border-border bg-background px-1 text-xs text-foreground"
            value={p.in}
            onChange={(e) => updateParam(i, "in", e.target.value)}
          >
            <option value="query">query</option>
            <option value="path">path</option>
            <option value="body">body</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={!!p.required}
              onChange={(e) => updateParam(i, "required", e.target.checked)}
            />
            req
          </label>
          <button
            type="button"
            onClick={() => removeParam(i)}
            className="text-muted-foreground transition-colors hover:text-destructive"
          >
            <X className="size-3.5" />
            <span className="sr-only">Remove param</span>
          </button>
        </div>
      ))}
    </div>
  )
}

// Same form for the "add new" section, each pending draft, and (mode:
// "edit") an existing registered entry opened via its row's Edit button -
// a pending entry is pre-filled from the AI's proposal but stays fully
// editable before approval, not shown as raw JSON.
function ApiForm({ draft, onChange, onSubmit, submitting, submitLabel, extraActions, mode = "add" }) {
  const set = (field) => (e) => onChange({ ...draft, [field]: e.target.value })

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      {mode === "edit" && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
          {!draft.skipHealthCheck && <HealthStatus api={draft} />}
          {draft.consecutiveFailures > 0 && <p>Consecutive failures: {draft.consecutiveFailures}</p>}
          {draft.disabledReason && <p>Disabled reason: {draft.disabledReason}</p>}
        </div>
      )}
      {(draft.category || draft.importNotes) && (
        <div className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
          {draft.category && <p className="mb-1 font-medium text-foreground">{draft.category}</p>}
          {draft.importNotes && (
            <>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Imported reference (from spreadsheet, not editable)
              </p>
              <p className="whitespace-pre-wrap">{draft.importNotes}</p>
            </>
          )}
        </div>
      )}
      <Input placeholder="Name (e.g. jikan_anime_search)" value={draft.name} onChange={set("name")} className="h-8 text-sm" />
      <Textarea
        placeholder="Description - what this API does and when to use it"
        value={draft.description}
        onChange={set("description")}
        className="min-h-14 text-sm"
      />
      <Input placeholder="Base URL (https://...)" value={draft.baseUrl} onChange={set("baseUrl")} className="h-8 text-sm" />
      <Input placeholder="Path (e.g. /v1/search or /users/{id})" value={draft.path} onChange={set("path")} className="h-8 text-sm" />
      <select
        className="h-8 w-fit rounded-md border border-border bg-background px-2 text-xs text-foreground"
        value={draft.method || "GET"}
        onChange={set("method")}
      >
        <option value="GET">GET</option>
        <option value="POST">POST</option>
      </select>
      <ParamsEditor params={draft.params || []} onChange={(params) => onChange({ ...draft, params })} />
      <div className="flex items-center gap-1.5">
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          value={draft.authType}
          onChange={set("authType")}
        >
          <option value="none">No auth</option>
          <option value="header">Header auth</option>
          <option value="query">Query param auth</option>
          <option value="bearer">Bearer Token</option>
        </select>
        {draft.authType !== "none" && (
          <>
            <Input
              placeholder="Env var (e.g. TAVILY_API_KEY)"
              value={draft.authEnvVar || ""}
              onChange={set("authEnvVar")}
              className="h-8 flex-1 text-xs"
            />
            {draft.authType !== "bearer" && (
              <Input
                placeholder="Key name (e.g. X-Subscription-Token)"
                value={draft.authKeyName || ""}
                onChange={set("authKeyName")}
                className="h-8 flex-1 text-xs"
              />
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Min interval (ms)
          <Input
            type="number"
            min="0"
            className="h-7 w-20 text-xs"
            value={draft.minIntervalMs ?? 350}
            onChange={(e) => onChange({ ...draft, minIntervalMs: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={!!draft.skipHealthCheck}
            onChange={(e) => onChange({ ...draft, skipHealthCheck: e.target.checked })}
          />
          Skip health check
        </label>
      </div>
      <HealthCheckParamsEditor
        value={draft.healthCheckParams}
        onChange={(healthCheckParams) => onChange({ ...draft, healthCheckParams })}
      />
      <div className="flex items-center justify-end gap-2">
        {extraActions}
        <Button type="button" size="sm" onClick={onSubmit} disabled={submitting} className="gap-1.5">
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

export function ApiRegistryDialog({ trigger }) {
  const [open, setOpen] = useState(false)
  const [apis, setApis] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(false)
  const [newDraft, setNewDraft] = useState(EMPTY_DRAFT)
  const [addingNew, setAddingNew] = useState(false)
  const [pendingDrafts, setPendingDrafts] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [pendingCategory, setPendingCategory] = useState("")
  const [apisCategory, setApisCategory] = useState("")
  const [pendingPage, setPendingPage] = useState(1)
  const [apisPage, setApisPage] = useState(1)
  const [editingApi, setEditingApi] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkApproveResult, setBulkApproveResult] = useState(null)
  const [bulkEnabling, setBulkEnabling] = useState(false)
  const [bulkEnableResult, setBulkEnableResult] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([getApis(), getPendingApis()])
      .then(([apiList, pendingList]) => {
        setApis(apiList)
        setPending(pendingList)
        setPendingDrafts(Object.fromEntries(pendingList.map((p) => [p.id, { ...p }])))
      })
      .catch((err) => toast({ variant: "destructive", title: "Couldn't load API registry", description: err.message }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  // Reset to page 1 whenever the list can shrink out from under the
  // current page (an approve/reject/delete/bulk-approve, or a category
  // filter change) - keyed off .length rather than the array reference so
  // an in-place edit (e.g. toggling enabled) doesn't bounce you back.
  useEffect(() => setPendingPage(1), [pending.length, pendingCategory])
  useEffect(() => setApisPage(1), [apis.length, apisCategory])
  // Clear a stale result from a previous category rather than leaving it
  // displayed against whatever category you've since switched to.
  useEffect(() => setBulkEnableResult(null), [apisCategory])

  const handleAdd = async () => {
    if (!newDraft.name.trim() || !newDraft.description.trim() || !newDraft.baseUrl.trim() || !newDraft.path.trim()) {
      toast({ variant: "destructive", title: "Fill in name, description, base URL, and path" })
      return
    }
    setAddingNew(true)
    try {
      await createApi(newDraft)
      setNewDraft(EMPTY_DRAFT)
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't add API", description: err.message })
    } finally {
      setAddingNew(false)
    }
  }

  const handleToggleEnabled = async (api) => {
    setBusyId(api.id)
    try {
      await updateApi(api.id, { enabled: !api.enabled })
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't update API", description: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleEditClick = (api) => {
    setEditingApi(api)
    setEditDraft({ ...api })
  }

  const closeEdit = () => {
    setEditingApi(null)
    setEditDraft(null)
  }

  const handleSaveEdit = async () => {
    if (!editingApi) return
    setSavingEdit(true)
    try {
      // Explicitly whitelisted rather than sending editDraft as-is - it's a
      // full copy of the entry, including `enabled`. The PATCH route treats
      // `enabled` as a special toggle (it resets consecutiveFailures/
      // disabledReason as a side effect - see adminApis.js), so sending it
      // unchanged from a plain field edit would silently overwrite
      // disabledReason: 'health_check' with 'manual' on every save, even
      // when the user never touched the enable/disable toggle at all.
      const {
        name,
        description,
        baseUrl,
        path,
        method,
        params,
        authType,
        authEnvVar,
        authKeyName,
        category,
        healthCheckParams,
        minIntervalMs,
        skipHealthCheck,
      } = editDraft
      await updateApi(editingApi.id, {
        name,
        description,
        baseUrl,
        path,
        method,
        params,
        authType,
        authEnvVar,
        authKeyName,
        category,
        healthCheckParams,
        minIntervalMs,
        skipHealthCheck,
      })
      closeEdit()
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't save changes", description: err.message })
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (id) => {
    setBusyId(id)
    try {
      await deleteApi(id)
      setApis((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't delete API", description: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleApprove = async (id) => {
    setBusyId(id)
    try {
      await approveApi(id, pendingDrafts[id])
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't approve API", description: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (id) => {
    setBusyId(id)
    try {
      await rejectApi(id)
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't reject API", description: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const handleBulkApprove = async () => {
    setBulkApproving(true)
    setBulkApproveResult(null)
    try {
      const result = await bulkApproveEligibleApis()
      setBulkApproveResult(result)
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Bulk approve failed", description: err.message })
    } finally {
      setBulkApproving(false)
    }
  }

  const handleBulkDelete = async () => {
    const confirmed = window.confirm(
      `Delete ALL ${apis.length + pending.length} registry entries (registered and pending)? This cannot be undone.`
    )
    if (!confirmed) return

    setBulkDeleting(true)
    try {
      const result = await bulkDeleteApis()
      toast({ title: "Registry cleared", description: `Deleted ${result.deletedCount} entries.` })
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Bulk delete failed", description: err.message })
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleBulkEnableCategory = async () => {
    if (!apisCategory) return
    setBulkEnabling(true)
    setBulkEnableResult(null)
    try {
      const result = await bulkEnableCategoryApis(apisCategory)
      setBulkEnableResult(result)
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Bulk enable failed", description: err.message })
    } finally {
      setBulkEnabling(false)
    }
  }

  const pendingCategories = [...new Set(pending.map((p) => p.category).filter(Boolean))].sort()
  const apisCategories = [...new Set(apis.map((a) => a.category).filter(Boolean))].sort()

  const filteredPending = pendingCategory ? pending.filter((p) => p.category === pendingCategory) : pending
  const filteredApis = apisCategory ? apis.filter((a) => a.category === apisCategory) : apis

  const pendingTotalPages = Math.max(1, Math.ceil(filteredPending.length / PAGE_SIZE))
  const apisTotalPages = Math.max(1, Math.ceil(filteredApis.length / PAGE_SIZE))
  const pendingPageItems = filteredPending.slice((pendingPage - 1) * PAGE_SIZE, pendingPage * PAGE_SIZE)
  const apisPageItems = filteredApis.slice((apisPage - 1) * PAGE_SIZE, apisPage * PAGE_SIZE)

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>External APIs</DialogTitle>
          <DialogDescription>
            Structured APIs the AI can call via call_external_api - faster and more reliable than browsing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          {pending.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Pending approval ({filteredPending.length})
                </p>
                <CategoryFilter categories={pendingCategories} value={pendingCategory} onChange={setPendingCategory} />
              </div>

              <div className="flex flex-col items-start gap-1 rounded-md border border-dashed border-border p-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1.5 text-xs"
                  onClick={handleBulkApprove}
                  disabled={bulkApproving}
                >
                  {bulkApproving && <Loader2 className="size-3.5 animate-spin" />}
                  Bulk Approve Eligible
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Approves entries that need no API key and no ID in their path - the rest need a quick look first.
                </p>
                {bulkApproveResult && (
                  <p className="text-[11px] font-medium text-foreground">
                    Approved {bulkApproveResult.approvedCount} entries. {bulkApproveResult.skippedCount} still need
                    auth setup or a path parameter filled in - still in the queue below.
                  </p>
                )}
              </div>

              {filteredPending.length === 0 && (
                <p className="px-1 py-2 text-center text-xs text-muted-foreground">No pending entries in this category</p>
              )}

              {pendingPageItems.map((p) => (
                <ApiForm
                  key={p.id}
                  draft={pendingDrafts[p.id] || p}
                  onChange={(next) => setPendingDrafts((prev) => ({ ...prev, [p.id]: next }))}
                  onSubmit={() => handleApprove(p.id)}
                  submitting={busyId === p.id}
                  submitLabel="Approve"
                  extraActions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReject(p.id)}
                      disabled={busyId === p.id}
                      className="text-destructive hover:text-destructive"
                    >
                      Reject
                    </Button>
                  }
                />
              ))}

              <Pagination page={pendingPage} totalPages={pendingTotalPages} onChange={setPendingPage} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Registered APIs ({filteredApis.length})
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={handleBulkEnableCategory}
                  disabled={!apisCategory || bulkEnabling}
                  title={apisCategory ? `Re-enable every disabled entry in "${apisCategory}"` : "Pick a category first"}
                >
                  {bulkEnabling && <Loader2 className="size-3.5 animate-spin" />}
                  Enable All in Category
                </Button>
                <CategoryFilter categories={apisCategories} value={apisCategory} onChange={setApisCategory} />
              </div>
            </div>
            {bulkEnableResult && (
              <p className="text-[11px] font-medium text-foreground">
                Re-enabled {bulkEnableResult.enabledCount} entr{bulkEnableResult.enabledCount === 1 ? "y" : "ies"} in
                "{apisCategory}".
              </p>
            )}
            {loading && Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
            {!loading && apis.length === 0 && (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">No APIs registered yet</p>
            )}
            {!loading && apis.length > 0 && filteredApis.length === 0 && (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">No registered APIs in this category</p>
            )}
            {!loading &&
              apisPageItems.map((api) => (
                <div key={api.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {api.name}
                      {api.category && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{api.category}</span>}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{api.description}</p>
                    {!api.skipHealthCheck && <HealthStatus api={api} />}
                    {api.disabledReason === "health_check" && (
                      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-500">
                        Auto-disabled: failing health checks
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => handleEditClick(api)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant={api.enabled ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => handleToggleEnabled(api)}
                    disabled={busyId === api.id}
                  >
                    {api.enabled ? "Enabled" : "Disabled"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(api.id)}
                    disabled={busyId === api.id}
                  >
                    <X className="size-3.5" />
                    <span className="sr-only">Delete {api.name}</span>
                  </Button>
                </div>
              ))}
            {!loading && <Pagination page={apisPage} totalPages={apisTotalPages} onChange={setApisPage} />}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Add API</p>
            <ApiForm draft={newDraft} onChange={setNewDraft} onSubmit={handleAdd} submitting={addingNew} submitLabel="Add" />
          </div>

          {(apis.length > 0 || pending.length > 0) && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/40 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-destructive">Danger zone</p>
              <p className="text-[11px] text-muted-foreground">
                Permanently deletes every registered and pending entry - no undo. Useful for clearing a bad bulk
                import wholesale.
              </p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-fit gap-1.5"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
              >
                {bulkDeleting && <Loader2 className="size-3.5 animate-spin" />}
                Remove All
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={!!editingApi} onOpenChange={(next) => !next && closeEdit()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {editingApi?.name}</DialogTitle>
          <DialogDescription>Changes save immediately to this registered API - no separate approval step.</DialogDescription>
        </DialogHeader>
        {editDraft && (
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <ApiForm
              draft={editDraft}
              onChange={setEditDraft}
              onSubmit={handleSaveEdit}
              submitting={savingEdit}
              submitLabel="Save"
              mode="edit"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  )
}
