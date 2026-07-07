import { createContext, useCallback, useContext, useEffect, useState } from "react"

import { getProjects, createProject as createProjectRequest } from "@/lib/api"
import { toast } from "@/hooks/use-toast"

const ProjectsContext = createContext(null)

export function ProjectsProvider({ children }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await getProjects()
      setProjects(Array.isArray(data) ? data : [])
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't load projects",
        description: err.message,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createProject = useCallback(async (name) => {
    const project = await createProjectRequest(name)
    setProjects((prev) => [project, ...prev])
    return project
  }, [])

  return (
    <ProjectsContext.Provider value={{ projects, loading, refresh, createProject }}>
      {children}
    </ProjectsContext.Provider>
  )
}

export function useProjects() {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider")
  return ctx
}
