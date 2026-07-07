import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { LogOut } from "lucide-react"

import { useAuth } from "@/context/AuthContext"
import { toast } from "@/hooks/use-toast"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

function getInitials(name, email) {
  const source = name?.trim() || email?.trim() || "?"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function UserMenu({ onNavigate }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)

  if (!user) return null

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      onNavigate?.()
      navigate("/login", { replace: true })
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't log out", description: err.message })
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1.5">
      <Avatar className="size-7">
        <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium text-foreground">{user.name || user.email}</p>
        {user.name && <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        onClick={handleLogout}
        disabled={loggingOut}
      >
        <LogOut className="size-3.5" />
        <span className="sr-only">Log out</span>
      </Button>
    </div>
  )
}
