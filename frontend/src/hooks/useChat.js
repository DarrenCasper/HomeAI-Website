import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { getConversation, sendMessage } from "@/lib/api"
import { DEFAULT_MODEL } from "@/lib/models"
import { useConversations } from "@/context/ConversationsContext"
import { toast } from "@/hooks/use-toast"

export function useChat(conversationId, projectId) {
  const navigate = useNavigate()
  const { upsertConversation, refresh } = useConversations()

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(Boolean(conversationId))
  const [pending, setPending] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODEL)

  // Set right before navigating away from a freshly-created conversation so the
  // load effect doesn't refetch messages we already have in state.
  const skipNextLoadRef = useRef(null)

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      setLoading(false)
      return
    }

    if (skipNextLoadRef.current === conversationId) {
      skipNextLoadRef.current = null
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    getConversation(conversationId)
      .then((data) => {
        if (cancelled) return
        const msgs = data.messages ?? []
        setMessages(msgs)
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant" && m.model)
        if (lastAssistant) setModel(lastAssistant.model)
      })
      .catch((err) => {
        if (cancelled) return
        toast({
          variant: "destructive",
          title: "Couldn't load conversation",
          description: err.message,
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [conversationId])

  const send = useCallback(
    async (text, attachments = []) => {
      const trimmed = text.trim()
      if ((!trimmed && attachments.length === 0) || pending) return

      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: trimmed,
          attachments: attachments.map((f) => ({ name: f.name, size: f.size })),
        },
      ])
      setPending(true)

      try {
        const res = await sendMessage({ message: trimmed, model, conversationId, projectId, attachments })
        const assistantMessage = res.message ?? { role: "assistant", content: res.content, model }
        setMessages((prev) => [...prev, assistantMessage])

        if (!conversationId && res.conversationId) {
          skipNextLoadRef.current = res.conversationId
          upsertConversation({
            id: res.conversationId,
            title: res.title || trimmed.slice(0, 60),
            updatedAt: new Date().toISOString(),
          })
          navigate(`/c/${res.conversationId}`, { replace: true })
        } else {
          refresh()
        }
      } catch (err) {
        setMessages((prev) => prev.slice(0, -1))
        toast({
          variant: "destructive",
          title: "Message failed to send",
          description: err.message,
        })
      } finally {
        setPending(false)
      }
    },
    [pending, model, conversationId, projectId, upsertConversation, refresh, navigate]
  )

  return { messages, loading, pending, model, setModel, send }
}
