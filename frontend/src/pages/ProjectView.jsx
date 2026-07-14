import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { MessageSquare, Plus } from "lucide-react"

import { getProject } from "@/lib/api"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function ProjectView() {
  const { projectId } = useParams()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProject(projectId)
      .then((data) => {
        if (!cancelled) setProject(data)
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Couldn't load project",
            description: err.message,
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const conversations = project?.conversations ?? []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 md:px-6">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            {loading ? (
              <Skeleton className="h-7 w-48" />
            ) : (
              <h1 className="text-xl font-semibold text-foreground">{project?.name}</h1>
            )}
            <p className="mt-1.5 text-sm text-muted-foreground">Chats in this project</p>
          </div>
          <Button asChild size="sm" className="shrink-0 gap-1.5">
            <Link to={`/p/${projectId}/new`}>
              <Plus className="size-4" />
              New chat
            </Link>
          </Button>
        </div>

        {loading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!loading && conversations.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No chats in this project yet. Start one to get going.
          </p>
        )}

        {!loading && conversations.length > 0 && (
          <div className="flex flex-col gap-1">
            {conversations.map((conversation) => (
              <Link
                key={conversation.id}
                to={`/c/${conversation.id}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{conversation.title || "Untitled chat"}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
