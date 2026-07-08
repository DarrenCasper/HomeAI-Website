import { useRef, useState } from "react"
import { MonitorUp, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { sendScreenCapture } from "@/lib/api"
import { toast } from "@/hooks/use-toast"

// Capture is on-demand (a button click), not on a timer - vision inference is
// much heavier per call than text, so continuous polling would hammer Ollama
// for little benefit.
export function ScreenShareButton({ conversationId, onCaptured, disabled }) {
  const [sharing, setSharing] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const streamRef = useRef(null)
  const videoRef = useRef(null)

  const stopShare = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setSharing(false)
  }

  const startShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setSharing(true)
      // Stop sharing automatically if the user ends it from the browser's own UI.
      stream.getVideoTracks()[0].addEventListener("ended", stopShare)
    } catch (err) {
      if (err.name === "NotAllowedError" && !window.isSecureContext) {
        toast({
          variant: "destructive",
          title: "Screen share needs HTTPS",
          description: "Screen capture only works over a secure connection (or localhost).",
        })
      }
      // Otherwise the user just cancelled the picker or denied permission -
      // not worth a toast for that.
    }
  }

  const captureAndAsk = async () => {
    if (!videoRef.current || !conversationId) return

    setCapturing(true)
    try {
      const canvas = document.createElement("canvas")
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      canvas.getContext("2d").drawImage(videoRef.current, 0, 0)
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7)
      const base64 = dataUrl.split(",")[1]

      const { description } = await sendScreenCapture({ image: base64, conversationId })
      onCaptured?.(description)
    } catch (err) {
      toast({ variant: "destructive", title: "Screen capture failed", description: err.message })
    } finally {
      setCapturing(false)
    }
  }

  return (
    <>
      {/* Kept off-screen but rendered (not display:none) so videoWidth/videoHeight populate. */}
      <video ref={videoRef} muted className="sr-only" />
      {!sharing ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={startShare}
          disabled={disabled}
          className="gap-1.5 px-2 text-muted-foreground"
        >
          <MonitorUp className="size-3.5" />
          Share screen
        </Button>
      ) : (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={captureAndAsk}
            disabled={capturing || !conversationId}
            className="gap-1.5 px-2"
          >
            <MonitorUp className="size-3.5" />
            {capturing ? "Capturing…" : "Capture & ask"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={stopShare}
            className="size-7 text-muted-foreground"
          >
            <X className="size-3.5" />
            <span className="sr-only">Stop sharing</span>
          </Button>
        </div>
      )}
    </>
  )
}
