import { useRef, useState } from "react"
import { ArrowUp, Globe, Loader2, Volume2, VolumeX, X } from "lucide-react"

import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { ModelSelector } from "@/components/chat/ModelSelector"
import { AttachMenu } from "@/components/chat/AttachMenu"
import { ScreenShareButton } from "@/components/chat/ScreenShareButton"
import { VoiceButton } from "@/components/chat/VoiceButton"

export function Composer({
  model,
  onModelChange,
  onSend,
  disabled,
  conversationId,
  preparingMessage,
  speakEnabled,
  onSpeakEnabledChange,
}) {
  const [value, setValue] = useState("")
  const [files, setFiles] = useState([])
  // Forwarded to /api/chat as browsingEnabled (see onSend/useChat.js's
  // send()) - when on, the backend nudges the model to actually use a tool
  // this turn instead of leaving it entirely up to the model's own judgment.
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
    onSend(value, files, frame, browsingEnabled)
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

  // Populates the input, doesn't send - the user reviews/edits a
  // transcription before it goes anywhere, same as anything they'd typed.
  const handleTranscribed = (text) => {
    setValue((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
    // The textarea's height only needs to catch up once React has actually
    // painted the new (possibly multi-line) value - a plain resize call
    // here would still read the stale scrollHeight from before this update.
    requestAnimationFrame(() => {
      if (textareaRef.current) resizeTextarea(textareaRef.current)
    })
  }

  return (
    <div className="border-t border-border bg-background px-4 pb-4 pt-3 md:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-border bg-card p-2.5 shadow-sm shadow-black/10">
        {/* Deliberately generic wording/icon - this also covers describing an
            active screen-share frame in the background, and revealing that
            would give away that screen-sharing affects answers at all. */}
        {preparingMessage && (
          <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Sending…
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

          <VoiceButton onTranscribed={handleTranscribed} disabled={disabled} />
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
              title="Force a web/API lookup for this message"
            >
              <Globe className="size-3.5" />
              Browse web
            </Button>
            <ScreenShareButton ref={screenShareRef} disabled={!conversationId} />
            <Button
              type="button"
              variant={speakEnabled ? "secondary" : "ghost"}
              size="icon"
              onClick={() => onSpeakEnabledChange?.((v) => !v)}
              className="size-8 shrink-0 text-muted-foreground data-[active=true]:text-foreground"
              data-active={speakEnabled}
              title={speakEnabled ? "Voice replies on" : "Voice replies off"}
            >
              {speakEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              <span className="sr-only">{speakEnabled ? "Turn off voice replies" : "Turn on voice replies"}</span>
            </Button>
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
