import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { MonitorUp, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"

// How often the off-screen canvas is refreshed with the current video frame
// while sharing is active. This is purely a client-side redraw - no network
// call happens on this interval. The vision model only ever gets invoked
// when the user actually sends a message (see Composer.jsx's handleSubmit
// grabbing captureFrame() at send time), so leaving a share running for
// minutes costs nothing beyond this local canvas redraw.
const FRAME_REFRESH_MS = 1000

// Exposes captureFrame() via ref instead of pushing frames up through props -
// the parent only ever needs "give me whatever's on screen right now" at the
// moment a message is sent, not a continuously updating value to react to.
export const ScreenShareButton = forwardRef(function ScreenShareButton({ disabled }, ref) {
  const [sharing, setSharing] = useState(false)
  const streamRef = useRef(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)

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

  useEffect(() => {
    if (!sharing) return
    const interval = setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return
      const canvas = canvasRef.current
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      canvas.getContext("2d").drawImage(videoRef.current, 0, 0)
    }, FRAME_REFRESH_MS)
    return () => clearInterval(interval)
  }, [sharing])

  useImperativeHandle(
    ref,
    () => ({
      // Returns the latest frame as base64 JPEG (no data: prefix), or null
      // if not currently sharing / no frame has landed on the canvas yet.
      captureFrame: () => {
        if (!sharing || !canvasRef.current || !canvasRef.current.width) return null
        const dataUrl = canvasRef.current.toDataURL("image/jpeg", 0.7)
        return dataUrl.split(",")[1]
      },
    }),
    [sharing]
  )

  return (
    <>
      {/* Kept off-screen but rendered (not display:none) so videoWidth/videoHeight populate. */}
      <video ref={videoRef} muted className="sr-only" />
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
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
          <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            <MonitorUp className="size-3.5" />
            Sharing screen
          </span>
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
})
