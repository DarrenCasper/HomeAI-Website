import { useRef, useState } from "react"
import { ArrowUp, Globe, X } from "lucide-react"

import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ModelSelector } from "@/components/chat/ModelSelector"
import { AttachMenu } from "@/components/chat/AttachMenu"

export function Composer({ model, onModelChange, onSend, disabled }) {
  const [value, setValue] = useState("")
  const [files, setFiles] = useState([])
  const textareaRef = useRef(null)

  const resizeTextarea = (el) => {
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const handleSubmit = () => {
    if ((!value.trim() && files.length === 0) || disabled) return
    onSend(value, files)
    setValue("")
    setFiles([])
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFilesPicked = (picked) => {
    setFiles((prev) => [...prev, ...picked])
  }

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="border-t border-border bg-background px-4 pb-4 pt-3 md:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-border bg-card p-2.5 shadow-sm shadow-black/10">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {files.map((file, i) => (
              <span
                key={`${file.name}-${i}`}
                className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
              >
                <span className="max-w-40 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                  <span className="sr-only">Remove {file.name}</span>
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <AttachMenu onFilesPicked={handleFilesPicked} />

          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              resizeTextarea(e.target)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="max-h-48 min-h-9 flex-1 px-1 py-1.5"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pl-10">
          <div className="flex items-center gap-1">
            <ModelSelector value={model} onChange={onModelChange} />
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled
                      className="gap-1.5 px-2 text-muted-foreground"
                    >
                      <Globe className="size-3.5" />
                      Web search
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Coming soon</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <Button
            size="icon"
            className="size-8 shrink-0 rounded-full"
            onClick={handleSubmit}
            disabled={disabled || (!value.trim() && files.length === 0)}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">
        Homelab AI can make mistakes. Responses run entirely on your local hardware.
      </p>
    </div>
  )
}
