import { Bot } from "lucide-react"

import { cn } from "@/lib/utils"
import { getModel } from "@/lib/models"

export function ModelAvatar({ className }) {
  return (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary",
        className
      )}
    >
      <Bot className="size-4" />
    </div>
  )
}

export function ModelTag({ model, className }) {
  const info = getModel(model)
  return <span className={cn("text-xs font-medium text-muted-foreground", className)}>{info.label}</span>
}
