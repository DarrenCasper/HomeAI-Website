import { useEffect, useRef, useState } from "react"
import { FileText, Loader2, Trash2, Upload } from "lucide-react"

import { deleteDocument, getDocuments, uploadDocument } from "@/lib/api"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function DocumentsDialog({ trigger }) {
  const [open, setOpen] = useState(false)
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingName, setDeletingName] = useState(null)
  const fileInputRef = useRef(null)

  const load = () => {
    setLoading(true)
    getDocuments()
      .then(setDocuments)
      .catch((err) => {
        toast({ variant: "destructive", title: "Couldn't load documents", description: err.message })
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  const handleFilePicked = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setUploading(true)
    try {
      await uploadDocument(file)
      load()
    } catch (err) {
      toast({ variant: "destructive", title: "Upload failed", description: err.message })
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (sourceFileName) => {
    setDeletingName(sourceFileName)
    try {
      await deleteDocument(sourceFileName)
      setDocuments((prev) => prev.filter((d) => d.sourceFileName !== sourceFileName))
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't delete document", description: err.message })
    } finally {
      setDeletingName(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Documents</DialogTitle>
          <DialogDescription>
            Uploaded notes the AI can search when a question needs them (the search_documents tool).
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md"
          className="hidden"
          onChange={handleFilePicked}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {uploading ? "Uploading…" : "Upload a file (PDF, TXT, MD)"}
        </Button>

        <div className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
          {loading &&
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}

          {!loading && documents.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">No documents uploaded yet</p>
          )}

          {!loading &&
            documents.map((doc) => (
              <div
                key={doc.sourceFileName}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{doc.sourceFileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"} · {formatDate(doc.uploadedAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(doc.sourceFileName)}
                  disabled={deletingName === doc.sourceFileName}
                >
                  {deletingName === doc.sourceFileName ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  <span className="sr-only">Delete {doc.sourceFileName}</span>
                </Button>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
