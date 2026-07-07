import { useState } from "react"
import { Outlet } from "react-router-dom"
import { PanelLeft } from "lucide-react"

import { ConversationsProvider } from "@/context/ConversationsContext"
import { ProjectsProvider } from "@/context/ProjectsContext"
import { SidebarContent } from "@/components/layout/Sidebar"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/toaster"

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <ConversationsProvider>
      <ProjectsProvider>
        <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
          <aside className="hidden w-72 shrink-0 border-r border-sidebar-border md:block">
            <SidebarContent />
          </aside>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="relative flex min-w-0 flex-1 flex-col">
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-2 z-20 md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <PanelLeft className="size-4" />
              <span className="sr-only">Open sidebar</span>
            </Button>

            <Outlet />
          </div>
        </div>

        <Toaster />
      </ProjectsProvider>
    </ConversationsProvider>
  )
}
