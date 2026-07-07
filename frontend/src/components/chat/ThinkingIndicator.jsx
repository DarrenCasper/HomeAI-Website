import { ModelAvatar, ModelTag } from "@/components/chat/ModelBadge"

export function ThinkingIndicator({ model }) {
  return (
    <div className="flex animate-in fade-in-0 slide-in-from-bottom-1 items-start gap-3 px-1 duration-300">
      <ModelAvatar />
      <div className="flex flex-col gap-1.5 pt-1">
        <ModelTag model={model} />
        <div className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5">
          <span className="text-xs text-muted-foreground">Thinking</span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0ms]" />
            <span className="size-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:180ms]" />
            <span className="size-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:360ms]" />
          </span>
        </div>
      </div>
    </div>
  )
}
