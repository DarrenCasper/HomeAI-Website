import { Navigate, Route, Routes } from "react-router-dom"

import { AuthProvider } from "@/context/AuthContext"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { AppLayout } from "@/components/layout/AppLayout"
import { ChatView } from "@/components/chat/ChatView"
import { ProjectView } from "@/pages/ProjectView"
import { UsagePage } from "@/pages/UsagePage"
import { LoginPage } from "@/pages/LoginPage"
import { RegisterPage } from "@/pages/RegisterPage"

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<ChatView />} />
            <Route path="c/:conversationId" element={<ChatView />} />
            <Route path="p/:projectId" element={<ProjectView />} />
            <Route path="p/:projectId/new" element={<ChatView />} />
            <Route path="usage" element={<UsagePage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
