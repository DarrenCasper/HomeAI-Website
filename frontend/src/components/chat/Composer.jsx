import { useRef, useState } from "react"
import { ArrowUp, Globe, MonitorUp, X } from "lucide-react"

import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { ModelSelector } from "@/components/chat/ModelSelector"
import { AttachMenu } from "@/components/chat/AttachMenu"
import { ScreenShareButton } from "@/components/chat/ScreenShareButton"

export function Composer({ model, onModelChange, onSend, disabled, conversationId, screenReading }) {
  const [value, setValue] = useState("")
  const [files, setFiles] = useState([])
  // Hint only, no request-shape change: the backend doesn't take a flag for
  // this today, so toggling it doesn't change what gets sent - it's here so
  // the control isn't a dead "Coming soon" tooltip, and to leave a clean
  // wiring point for whenever /api/chat grows a real tool-calling loop.
  const [browsingEnabled, setBrowsingEnabled] = useState(false)
  const textareaRef = useRef(null)
  const screenShareRef = useRef(null)

  const resizeTextarea = (el) => {
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const handleSubmit = () => {
    if ((!value.trim() && files.length === 0) || disabled) return
    // null whenever screen-share isn't active - onSend/useChat treats that
    // exactly like sending without a frame at all.
    const frame = screenShareRef.current?.captureFrame() ?? null
    onSend(value, files, frame)
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
        {screenReading && (
          <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <MonitorUp className="size-3.5 animate-pulse" />
            Reading your screen…
          </div>
        )}

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
            <Button
              type="button"
              variant={browsingEnabled ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setBrowsingEnabled((v) => !v)}
              className="gap-1.5 px-2 text-muted-foreground data-[active=true]:text-foreground"
              data-active={browsingEnabled}
            >
              <Globe className="size-3.5" />
              Browse web
            </Button>
            <ScreenShareButton ref={screenShareRef} disabled={!conversationId} />
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
