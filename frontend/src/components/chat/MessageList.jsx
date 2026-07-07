import { useEffect, useRef } from "react"
import { Sparkles } from "lucide-react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator"

export function MessageList({ messages, loading, pending, model }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length, pending])

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2 pt-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/15">
          <Sparkles className="size-5 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">What can I help with?</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Ask anything — your conversation stays on this machine.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
        {messages.map((message, i) => (
          <MessageBubble key={i} message={message} />
        ))}
        {pending && <ThinkingIndicator model={model} />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
