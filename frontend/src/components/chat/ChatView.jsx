import { useParams } from "react-router-dom"

import { useChat } from "@/hooks/useChat"
import { MessageList } from "@/components/chat/MessageList"
import { Composer } from "@/components/chat/Composer"

export function ChatView() {
  const { conversationId, projectId } = useParams()
  const { messages, loading, pending, model, setModel, send, addUserNote } = useChat(
    conversationId,
    projectId
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessageList messages={messages} loading={loading} pending={pending} model={model} />
      <Composer
        model={model}
        onModelChange={setModel}
        onSend={send}
        disabled={pending}
        conversationId={conversationId}
        onScreenCaptured={addUserNote}
      />
    </div>
  )
}
