import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { getConversation, getChatJob, postChat, sendMessage, sendScreenCapture, speakText } from "@/lib/api"
import { DEFAULT_MODEL, MODELS } from "@/lib/models"
import { useConversations } from "@/context/ConversationsContext"
import { toast } from "@/hooks/use-toast"

const JOB_POLL_INTERVAL_MS = 2500

// Must match backend/src/routes/chat.js's HEARTBEAT_SENTINEL - the backend
// interleaves this into the stream during slow tool calls to keep
// Cloudflare's proxy from timing out the connection; it carries no visible
// content and must be stripped before the chunk is appended to the message.
const HEARTBEAT_SENTINEL = '\u0000'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useChat(conversationId, projectId) {
  const navigate = useNavigate()
  const { upsertConversation, refresh } = useConversations()

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(Boolean(conversationId))
  const [pending, setPending] = useState(false)
  // True only while describing an active screen-share frame, ahead of the
  // real /api/chat call - kept generic ("preparing", not "reading screen")
  // because the whole point of this flow is that screen-sharing's effect on
  // answers is invisible; a distinctly-worded loading state would give it away.
  const [preparingMessage, setPreparingMessage] = useState(false)
  // Off by default (see VoiceButton.jsx/Composer.jsx's speaker toggle) -
  // auto-playing speech for every reply unconditionally gets old fast.
  const [speakEnabled, setSpeakEnabled] = useState(false)
  const [model, setModel] = useState(DEFAULT_MODEL)

  // Set right before navigating away from a freshly-created conversation so the
  // load effect doesn't refetch messages we already have in state.
  const skipNextLoadRef = useRef(null)
  // Flips once this hook instance unmounts, so an in-flight stream/poll loop
  // stops touching state instead of warning about updates after unmount.
  const abortRef = useRef(false)

  useEffect(() => () => {
    abortRef.current = true
  }, [])

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
        // Only trust a conversation's last-used model if it's still
        // selectable today - an older conversation may have been started
        // with a model that's since been removed (e.g. deepseek-r1, or an
        // old qwen3.5 tag), and blindly restoring it would silently lock
        // every future message in that thread onto a dead model tag with
        // no way to override it now that the picker collapses to a single
        // static label (see ModelSelector.jsx) when only one model exists.
        const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant" && m.model)
        if (lastAssistant && MODELS.some((m) => m.value === lastAssistant.model)) {
          setModel(lastAssistant.model)
        }
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

  // Appends a delta to the in-progress assistant message, creating it on the
  // first call - this is what makes the "thinking" indicator disappear
  // exactly when real content starts arriving (see MessageList).
  const appendAssistantDelta = useCallback((delta, msgModel) => {
    if (!delta) return
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === "assistant" && last.__streaming) {
        const updated = [...prev]
        updated[updated.length - 1] = { ...last, content: last.content + delta }
        return updated
      }
      return [...prev, { role: "assistant", content: delta, model: msgModel, __streaming: true }]
    })
  }, [])

  // Job polling delivers a full snapshot each tick rather than a delta.
  // Ollama streams a reasoning model's thinking tokens before any content
  // (see backend lib/ollama.js), so this has to create the placeholder
  // message on thinking alone too, not just once content shows up.
  const setAssistantContent = useCallback((content, msgModel, thinking) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === "assistant" && last.__streaming) {
        const updated = [...prev]
        updated[updated.length - 1] = { ...last, content, thinking, model: msgModel }
        return updated
      }
      if (!content && !thinking) return prev
      return [...prev, { role: "assistant", content, thinking, model: msgModel, __streaming: true }]
    })
  }, [])

  const finalizeAssistantMessage = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== "assistant") return prev
      const { __streaming, ...clean } = last
      const updated = [...prev]
      updated[updated.length - 1] = clean
      return updated
    })
  }, [])

  const dropAssistantPlaceholder = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === "assistant" && last.__streaming) return prev.slice(0, -1)
      return prev
    })
  }, [])

  // Best-effort: a broken/unreachable voice-agent shouldn't interrupt the
  // chat flow with a toast for what's an optional, off-by-default feature -
  // logged and silently dropped instead. `new Audio(url)` is a genuine
  // HTMLAudioElement (same constructor `document.createElement("audio")`
  // backs), just not attached to the DOM tree, so no extra state/JSX is
  // needed to render one.
  const playSpokenText = useCallback(async (text) => {
    if (!text || !text.trim()) return
    try {
      const response = await speakText(text)
      if (!response.ok) throw new Error(`Speech synthesis failed (${response.status})`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.addEventListener("ended", () => URL.revokeObjectURL(url))
      audio.addEventListener("error", () => URL.revokeObjectURL(url))
      await audio.play()
    } catch (err) {
      console.error("Voice reply failed:", err.message)
    }
  }, [])

  const handleNewConversationId = useCallback(
    (newId, title) => {
      if (!newId || conversationId) return
      skipNextLoadRef.current = newId
      upsertConversation({ id: newId, title, updatedAt: new Date().toISOString() })
      navigate(`/c/${newId}`, { replace: true })
    },
    [conversationId, upsertConversation, navigate]
  )

  const send = useCallback(
    async (text, attachments = [], frame = null, browsingEnabled = false) => {
      const trimmed = text.trim()
      if ((!trimmed && attachments.length === 0) || pending) return

      setPending(true)

      // A screen-share frame gets described first, but only ever as ambient
      // context passed to /api/chat below - never inserted into the visible
      // transcript, and never sent to /api/chat as anything but the
      // screenContext field. conversationId is required since /api/vision
      // attaches to an existing conversation; captureFrame() only ever
      // returns non-null once sharing is allowed to start, which itself
      // requires a conversationId (see Composer.jsx), so this is a
      // defensive check, not the normal path.
      let screenContext = null
      if (frame && conversationId) {
        setPreparingMessage(true)
        try {
          const { description } = await sendScreenCapture({ image: frame, conversationId })
          screenContext = description
        } catch (err) {
          // Vision failed or timed out - degrade gracefully and send the
          // message without screen context rather than blocking the whole
          // send, same principle as the browse_web tool falling back when
          // the browsing agent is unreachable.
          console.error("Screen capture failed, sending without it:", err.message)
        } finally {
          setPreparingMessage(false)
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: trimmed,
          attachments: attachments.map((f) => ({ name: f.name, size: f.size })),
        },
      ])

      // The backend's /api/chat only accepts a JSON body today - attachments
      // fall back to the old single-shot multipart call so the failure
      // surfaces as a normal toast instead of silently dropping files.
      if (attachments.length > 0) {
        try {
          const res = await sendMessage({ message: trimmed, model, conversationId, projectId, attachments })
          const assistantMessage = res.message ?? { role: "assistant", content: res.content, model }
          setMessages((prev) => [...prev, assistantMessage])
          handleNewConversationId(res.conversationId, res.title || trimmed.slice(0, 60))
          refresh()
        } catch (err) {
          setMessages((prev) => prev.slice(0, -1))
          toast({ variant: "destructive", title: "Message failed to send", description: err.message })
        } finally {
          setPending(false)
        }
        return
      }

      try {
        const response = await postChat({ message: trimmed, model, conversationId, projectId, screenContext, browsingEnabled })
        const contentType = response.headers.get("content-type") || ""

        if (contentType.includes("application/json")) {
          const data = await response.json()
          if (data.mode !== "job") {
            throw new Error(data.error || "Unexpected response from server")
          }

          handleNewConversationId(data.conversationId, trimmed.slice(0, 60))

          while (true) {
            await sleep(JOB_POLL_INTERVAL_MS)
            if (abortRef.current) return

            const job = await getChatJob(data.jobId)

            if (job.status === "error") {
              dropAssistantPlaceholder()
              toast({ variant: "destructive", title: "Message failed to send", description: job.error })
              break
            }
            if (job.status === "done") {
              setAssistantContent(job.answer, model, job.thinking || "")
              finalizeAssistantMessage()
              if (speakEnabled) playSpokenText(job.answer)
              break
            }
            setAssistantContent(job.partial || "", model, job.thinking || "")
          }
        } else {
          handleNewConversationId(response.headers.get("x-conversation-id"), trimmed.slice(0, 60))

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let fullReply = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (abortRef.current) {
              reader.cancel()
              return
            }
            const filtered = decoder.decode(value, { stream: true }).split(HEARTBEAT_SENTINEL).join("")
            if (filtered) {
              fullReply += filtered
              appendAssistantDelta(filtered, model)
            }
          }

          finalizeAssistantMessage()
          if (speakEnabled) playSpokenText(fullReply)
        }

        refresh()
      } catch (err) {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          const withoutStreaming = last?.role === "assistant" && last.__streaming ? prev.slice(0, -1) : prev
          return withoutStreaming.slice(0, -1) // also drop the optimistic user turn
        })
        toast({ variant: "destructive", title: "Message failed to send", description: err.message })
      } finally {
        setPending(false)
      }
    },
    [
      pending,
      model,
      conversationId,
      projectId,
      speakEnabled,
      refresh,
      appendAssistantDelta,
      setAssistantContent,
      finalizeAssistantMessage,
      dropAssistantPlaceholder,
      handleNewConversationId,
      playSpokenText,
    ]
  )

  return {
    messages,
    loading,
    pending,
    preparingMessage,
    speakEnabled,
    setSpeakEnabled,
    model,
    setModel,
    send,
  }
}
