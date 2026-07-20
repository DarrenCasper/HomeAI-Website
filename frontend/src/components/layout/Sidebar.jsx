import { NavLink } from "react-router-dom"
import { BarChart3, FileText, Folder, Key, MessageSquare, Plug, Plus, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { useConversations } from "@/context/ConversationsContext"
import { useProjects } from "@/context/ProjectsContext"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { NewProjectDialog } from "@/components/layout/NewProjectDialog"
import { ProjectMenu } from "@/components/layout/ProjectMenu"
import { ConversationMenu } from "@/components/layout/ConversationMenu"
import { DocumentsDialog } from "@/components/layout/DocumentsDialog"
import { ApiRegistryDialog } from "@/components/layout/ApiRegistryDialog"
import { ApiSecretsDialog } from "@/components/layout/ApiSecretsDialog"
import { UserMenu } from "@/components/layout/UserMenu"

const navLinkClasses = ({ isActive }) =>
  cn(
    "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/90 transition-colors hover:bg-accent",
    isActive && "bg-accent text-foreground"
  )

export function SidebarContent({ onNavigate }) {
  const { conversations, loading: conversationsLoading } = useConversations()
  const { projects, loading: projectsLoading } = useProjects()

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/15">
          <Sparkles className="size-4 text-primary" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-foreground">Homelab AI</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            Local node active
          </span>
        </div>
      </div>

      <div className="px-3">
        <NavLink
          to="/"
          end
          onClick={onNavigate}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" />
          New chat
        </NavLink>
      </div>

      <div className="mt-5 px-3">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Projects
          </span>
          <NewProjectDialog onNavigate={onNavigate} />
        </div>
        <div className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto scrollbar-thin">
          {projectsLoading &&
            Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}

          {!projectsLoading && projects.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">No projects yet</p>
          )}

          {!projectsLoading &&
            projects.map((project) => (
              <div key={project.id} className="group flex items-center">
                <NavLink
                  to={`/p/${project.id}`}
                  onClick={onNavigate}
                  className={(state) => cn(navLinkClasses(state), "min-w-0 flex-1")}
                >
                  <Folder className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="min-w-0 truncate">{project.name}</span>
                </NavLink>
                <ProjectMenu project={project} onNavigate={onNavigate} />
              </div>
            ))}
        </div>
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
        <span className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Recent chats
        </span>
        <ScrollArea className="mt-2 flex-1">
          <div className="flex flex-col gap-0.5 pb-4 pr-2">
            {conversationsLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))}

            {!conversationsLoading && conversations.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No conversations yet
              </p>
            )}

            {!conversationsLoading &&
              conversations.map((conversation) => (
                <div key={conversation.id} className="group flex items-center">
                  <NavLink
                    to={`/c/${conversation.id}`}
                    onClick={onNavigate}
                    className={(state) => cn(navLinkClasses(state), "min-w-0 flex-1")}
                  >
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                    <span className="min-w-0 truncate">{conversation.title || "Untitled chat"}</span>
                  </NavLink>
                  <ConversationMenu conversation={conversation} onNavigate={onNavigate} />
                </div>
              ))}
          </div>
        </ScrollArea>
      </div>

      <div className="border-t border-sidebar-border px-3 py-3">
        <DocumentsDialog
          trigger={
            <button type="button" className={navLinkClasses({ isActive: false })}>
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              Documents
            </button>
          }
        />
        <ApiRegistryDialog
          trigger={
            <button type="button" className={navLinkClasses({ isActive: false })}>
              <Plug className="size-3.5 shrink-0 text-muted-foreground" />
              External APIs
            </button>
          }
        />
        <ApiSecretsDialog
          trigger={
            <button type="button" className={navLinkClasses({ isActive: false })}>
              <Key className="size-3.5 shrink-0 text-muted-foreground" />
              API Secrets
            </button>
          }
        />
        <NavLink to="/usage" onClick={onNavigate} className={navLinkClasses}>
          <BarChart3 className="size-3.5 shrink-0 text-muted-foreground" />
          Usage
        </NavLink>
        <UserMenu onNavigate={onNavigate} />
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Homelab AI processes data locally. No telemetry.
        </p>
      </div>
    </div>
  )
}
