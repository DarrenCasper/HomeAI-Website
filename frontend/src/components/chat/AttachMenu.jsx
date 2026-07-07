import { useRef } from "react"
import { Image, Paperclip, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,.txt,.md,.csv,.json,.xls,.xlsx,.ppt,.pptx,.rtf,.log,.yaml,.yml"

export function AttachMenu({ onFilesPicked }) {
  const photoInputRef = useRef(null)
  const fileInputRef = useRef(null)

  const handleChange = (e) => {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length > 0) onFilesPicked(picked)
    e.target.value = ""
  }

  return (
    <>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={handleChange}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-full text-muted-foreground"
          >
            <Plus className="size-4" />
            <span className="sr-only">Attach</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-48">
          <DropdownMenuItem onSelect={() => photoInputRef.current?.click()} className="gap-2">
            <Image className="size-4 text-muted-foreground" />
            Upload photo
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fileInputRef.current?.click()} className="gap-2">
            <Paperclip className="size-4 text-muted-foreground" />
            Upload file
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
