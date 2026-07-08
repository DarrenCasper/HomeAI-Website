import { createContext, useCallback, useContext, useEffect, useState } from "react"

import { getHistory, deleteConversation as deleteConversationRequest } from "@/lib/api"
import { toast } from "@/hooks/use-toast"

const ConversationsContext = createContext(null)

export function ConversationsProvider({ children }) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await getHistory()
      setConversations(Array.isArray(data) ? data : [])
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't load chat history",
        description: err.message,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Moves a conversation to the top of the sidebar without waiting on a full refetch,
  // used right after the first message of a brand-new chat creates it server-side.
  const upsertConversation = useCallback((conversation) => {
    setConversations((prev) => [conversation, ...prev.filter((c) => c.id !== conversation.id)])
  }, [])

  const deleteConversation = useCallback(async (id) => {
    await deleteConversationRequest(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return (
    <ConversationsContext.Provider
      value={{ conversations, loading, refresh, upsertConversation, deleteConversation }}
    >
      {children}
    </ConversationsContext.Provider>
  )
}

export function useConversations() {
  const ctx = useContext(ConversationsContext)
  if (!ctx) throw new Error("useConversations must be used within ConversationsProvider")
  return ctx
}
