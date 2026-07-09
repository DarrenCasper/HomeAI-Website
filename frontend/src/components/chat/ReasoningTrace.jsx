import { useEffect, useRef, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

// Collapsible section for a reasoning model's chain-of-thought (deepseek-r1,
// via Ollama's `think` param - see backend lib/ollama.js). Starts expanded
// while the model is still thinking, then auto-collapses the first time real
// answer content shows up - same pattern as ChatGPT/DeepSeek's own UI. The
// user can still freely re-toggle it afterward.
export function ReasoningTrace({ thinking, hasAnswer }) {
  const [open, setOpen] = useState(true)
  const autoCollapsedRef = useRef(false)

  useEffect(() => {
    if (hasAnswer && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true
      setOpen(false)
    }
  }, [hasAnswer])

  if (!thinking) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Sparkles className="size-3.5" />
        {hasAnswer ? "Thinking" : "Thinking…"}
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {thinking}
        </div>
      )}
    </div>
  )
}
