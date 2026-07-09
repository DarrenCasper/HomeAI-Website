import { Monitor, Paperclip } from "lucide-react"

import { FormattedContent } from "@/components/chat/FormattedContent"
import { ReasoningTrace } from "@/components/chat/ReasoningTrace"
import { ModelAvatar, ModelTag } from "@/components/chat/ModelBadge"

const SCREEN_SHARE_PREFIX = "[Screen share] "

function AttachmentChips({ attachments }) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {attachments.map((attachment, i) => (
        <span
          key={`${attachment.name}-${i}`}
          className="flex items-center gap-1.5 rounded-md bg-background/40 px-2 py-1 text-xs text-foreground/90"
        >
          <Paperclip className="size-3" />
          <span className="max-w-40 truncate">{attachment.name}</span>
        </span>
      ))}
    </div>
  )
}

export function MessageBubble({ message }) {
  const isUser = message.role === "user"

  if (isUser) {
    const isScreenShare = message.content?.startsWith(SCREEN_SHARE_PREFIX)
    const displayContent = isScreenShare
      ? message.content.slice(SCREEN_SHARE_PREFIX.length)
      : message.content

    return (
      <div className="flex animate-in fade-in-0 slide-in-from-bottom-1 flex-col items-end px-1 duration-300">
        <AttachmentChips attachments={message.attachments} />
        {displayContent && (
          <div className="max-w-[80%] rounded-2xl bg-card px-4 py-2.5 text-sm text-foreground">
            {isScreenShare && (
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Monitor className="size-3.5" />
                Screen share
              </div>
            )}
            <FormattedContent content={displayContent} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex animate-in fade-in-0 slide-in-from-bottom-1 items-start gap-3 px-1 duration-300">
      <ModelAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
        <ModelTag model={message.model} />
        {message.thinking && (
          <ReasoningTrace thinking={message.thinking} hasAnswer={Boolean(message.content)} />
        )}
        <div className="max-w-full text-sm text-foreground">
          <FormattedContent content={message.content} />
        </div>
      </div>
    </div>
  )
}
