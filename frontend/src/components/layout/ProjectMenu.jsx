import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"

import { useProjects } from "@/context/ProjectsContext"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ProjectMenu({ project, onNavigate }) {
  const { renameProject, deleteProject } = useProjects()
  const navigate = useNavigate()
  const { projectId: activeProjectId } = useParams()

  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState(project.name)
  const [submitting, setSubmitting] = useState(false)

  const handleRename = async () => {
    const trimmed = name.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    try {
      await renameProject(project.id, trimmed)
      setRenameOpen(false)
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't rename project", description: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (submitting) return

    setSubmitting(true)
    try {
      await deleteProject(project.id)
      setDeleteOpen(false)
      if (activeProjectId === project.id) navigate("/")
      onNavigate?.()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't delete project", description: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
            <span className="sr-only">Project options</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => {
              setName(project.name)
              setRenameOpen(true)
            }}
          >
            <Pencil className="size-3.5 text-muted-foreground" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="button" size="sm" onClick={handleRename} disabled={!name.trim() || submitting}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              "{project.name}" will be deleted. Its chats stay in your history, just no longer grouped
              under it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={submitting}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
