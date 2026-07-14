import { useEffect, useState } from "react"
import { Loader2, Plus, X } from "lucide-react"

import {
  approveApi,
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

// Same form for the "add new" section and each pending draft - a pending
// entry is pre-filled from the AI's proposal but stays fully editable
// before approval, not shown as raw JSON.
function ApiForm({ draft, onChange, onSubmit, submitting, submitLabel, extraActions }) {
  const set = (field) => (e) => onChange({ ...draft, [field]: e.target.value })

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
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

  return (
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
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pending approval</p>
              {pending.map((p) => (
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
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Registered APIs</p>
            {loading && Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
            {!loading && apis.length === 0 && (
              <p className="px-1 py-2 text-center text-xs text-muted-foreground">No APIs registered yet</p>
            )}
            {!loading &&
              apis.map((api) => (
                <div key={api.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{api.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{api.description}</p>
                  </div>
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
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Add API</p>
            <ApiForm draft={newDraft} onChange={setNewDraft} onSubmit={handleAdd} submitting={addingNew} submitLabel="Add" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
