import { Navigate, Outlet, useLocation } from "react-router-dom"
import { Sparkles } from "lucide-react"

import { useAuth } from "@/context/AuthContext"

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background">
        <div className="flex size-11 animate-pulse items-center justify-center rounded-2xl bg-primary/15">
          <Sparkles className="size-5 text-primary" />
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
