import { useRef, useState } from "react"
import { Loader2, Mic, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { transcribeAudio } from "@/lib/api"
import { toast } from "@/hooks/use-toast"

// Press to record, press again to stop - transcribes on stop and hands the
// text back to the caller (Composer.jsx populates the text input with it).
// Never auto-sends: the user reviews/edits it first, same as if they'd typed it.
export function VoiceButton({ onTranscribed, disabled }) {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
        chunksRef.current = []
        if (blob.size === 0) return

        setTranscribing(true)
        try {
          const { text } = await transcribeAudio(blob)
          if (text) onTranscribed(text)
        } catch (err) {
          toast({ variant: "destructive", title: "Transcription failed", description: err.message })
        } finally {
          setTranscribing(false)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err) {
      if (err.name === "NotAllowedError" && !window.isSecureContext) {
        toast({
          variant: "destructive",
          title: "Voice input needs HTTPS",
          description: "Microphone access only works over a secure connection (or localhost).",
        })
      }
      // Otherwise the user just denied mic permission or cancelled - not
      // worth a toast for that.
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  return (
    <Button
      type="button"
      variant={recording ? "destructive" : "ghost"}
      size="icon"
      className="size-8 shrink-0 rounded-full"
      onClick={recording ? stopRecording : startRecording}
      disabled={disabled || transcribing}
    >
      {transcribing ? (
        <Loader2 className="size-4 animate-spin" />
      ) : recording ? (
        <Square className="size-3.5" />
      ) : (
        <Mic className="size-4" />
      )}
      <span className="sr-only">{recording ? "Stop recording" : "Record voice message"}</span>
    </Button>
  )
}
