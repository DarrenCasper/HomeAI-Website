import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { getReferencedSecrets, setSecret } from "@/lib/api"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

const SOURCE_LABEL = {
  database: "Set via database",
  environment: "Set via environment",
  unset: "Not set",
}
const SOURCE_DOT = {
  database: "bg-emerald-500",
  environment: "bg-emerald-500",
  unset: "bg-muted-foreground/40",
}

// A saved value is never sent back from the server (see lib/apiSecrets.js),
// so this input always starts empty and stays that way after a save -
// there's nothing to pre-fill it with, by design.
function SecretRow({ secret, onSaved }) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await setSecret(secret.envVarName, value)
      setValue("")
      toast({ title: `${secret.envVarName} saved` })
      onSaved()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't save secret", description: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm text-foreground">{secret.envVarName}</span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${SOURCE_DOT[secret.source]}`} aria-hidden="true" />
          {SOURCE_LABEL[secret.source]}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="password"
          placeholder="New value - never shown once saved"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 flex-1 text-xs"
          autoComplete="off"
        />
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5"
          onClick={handleSave}
          disabled={saving || !value.trim()}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  )
}

export function ApiSecretsDialog({ trigger }) {
  const [open, setOpen] = useState(false)
  const [secrets, setSecrets] = useState([])
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    getReferencedSecrets()
      .then(setSecrets)
      .catch((err) => toast({ variant: "destructive", title: "Couldn't load secrets", description: err.message }))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>API Secrets</DialogTitle>
          <DialogDescription>
            Keys referenced by a registered or pending API. Set one here instead of redeploying for each key - values
            are never sent back once saved.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto pr-1">
          {loading && Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
          {!loading && secrets.length === 0 && (
            <p className="px-1 py-2 text-center text-xs text-muted-foreground">
              No registered or pending API currently references an env var
            </p>
          )}
          {!loading && secrets.map((secret) => <SecretRow key={secret.envVarName} secret={secret} onSaved={load} />)}
        </div>
      </DialogContent>
    </Dialog>
  )
}
