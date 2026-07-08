import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { MoreHorizontal, Trash2 } from "lucide-react"

import { useConversations } from "@/context/ConversationsContext"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
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

export function ConversationMenu({ conversation, onNavigate }) {
  const { deleteConversation } = useConversations()
  const navigate = useNavigate()
  const { conversationId: activeConversationId } = useParams()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Same fix as ProjectMenu: opening a Dialog directly from a
  // DropdownMenuItem's onSelect races with Radix's focus-return-on-close and
  // can eat the Dialog's open state - defer to the next tick.
  const openAfterMenuCloses = (fn) => {
    setTimeout(fn, 0)
  }

  const handleDelete = async () => {
    if (submitting) return

    setSubmitting(true)
    try {
      await deleteConversation(conversation.id)
      setDeleteOpen(false)
      if (activeConversationId === conversation.id) navigate("/")
      onNavigate?.()
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't delete chat", description: err.message })
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
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="size-3.5" />
            <span className="sr-only">Chat options</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem
            className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => openAfterMenuCloses(() => setDeleteOpen(true))}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              "{conversation.title || "Untitled chat"}" and its messages will be permanently deleted.
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
