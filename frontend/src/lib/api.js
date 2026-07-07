// In local dev VITE_API_URL is unset, so this stays a relative "/api" and
// goes through the Vite dev server's proxy (vite.config.js). In production
// there is no proxy in front of the static build (nginx.conf just serves the
// SPA), so VITE_API_URL must point at the backend's own origin, e.g.
// https://api-homeai.darrencasper.com - set as a build arg in the Dockerfile.
const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "")
const BASE = `${API_ORIGIN}/api`

async function handleResponse(res) {
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    try {
      const body = await res.json()
      message = body?.error || body?.message || message
    } catch {
      // response wasn't JSON, fall back to the generic status message
    }
    throw new Error(message)
  }
  if (res.status === 204) return null
  return res.json()
}

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    // Required for the session cookie (backend src/lib/session.js) to be
    // sent/accepted cross-origin against api-homeai.darrencasper.com - the
    // default fetch credentials mode ("same-origin") would silently drop it.
    credentials: "include",
    ...options,
  })
  return handleResponse(res)
}

// GET /api/history -> [{ id, title, updatedAt, projectId? }], most recent first
export function getHistory() {
  return request("/history")
}

// GET /api/history/:id -> { id, title, messages: [{ role, content, model?, attachments? }] }
export function getConversation(id) {
  return request(`/history/${id}`)
}

// Legacy single-shot call, kept only for the attachments path below - the
// Homelab AI backend's /api/chat now always responds with either a stream or
// a job descriptor (see postChat above), never this shape, and it doesn't
// parse multipart bodies either. Sending attachments will fail against the
// real backend today; this exists so that failure surfaces as a normal toast
// instead of silently dropping files, and so it's a one-line change to wire
// up once the backend grows multipart support.
export function sendMessage({ message, model, conversationId, projectId, attachments }) {
  if (attachments && attachments.length > 0) {
    const form = new FormData()
    form.append("message", message)
    form.append("model", model)
    if (conversationId) form.append("conversationId", conversationId)
    if (projectId) form.append("projectId", projectId)
    for (const file of attachments) form.append("attachments", file)

    return fetch(`${BASE}/chat`, { method: "POST", body: form, credentials: "include" }).then(
      handleResponse
    )
  }

  return request("/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      model,
      ...(conversationId ? { conversationId } : {}),
      ...(projectId ? { projectId } : {}),
    }),
  })
}

// POST /api/chat { message, model, conversationId?, projectId? } -> raw Response.
// projectId only matters when starting a brand-new conversation (no
// conversationId) - it tags that conversation into the project.
// The backend picks one of two response shapes depending on the model (see
// backend src/utils/modelMode.js):
//  - stream mode: 200, Content-Type text/plain, body is raw text chunks, and
//    an X-Conversation-Id header carries the (possibly brand-new) conversation id.
//  - job mode: 200 JSON { mode: "job", jobId, status, statusUrl, conversationId }
// Callers must branch on response.headers.get("content-type") themselves -
// this stays unparsed so streaming callers can read response.body directly.
export function postChat({ message, model, conversationId, projectId }) {
  return fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      message,
      model,
      ...(conversationId ? { conversationId } : {}),
      ...(projectId ? { projectId } : {}),
    }),
  })
}

// GET /api/chat/jobs/:jobId -> { jobId, status, model, partial? | answer? | error? }
export function getChatJob(jobId) {
  return request(`/chat/jobs/${jobId}`)
}

// GET /api/projects -> [{ id, name, updatedAt }], most recent first
export function getProjects() {
  return request("/projects")
}

// GET /api/projects/:id -> { id, name, conversations: [{ id, title, updatedAt }] }
export function getProject(id) {
  return request(`/projects/${id}`)
}

// POST /api/projects { name } -> { id, name }
export function createProject(name) {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  })
}

// PATCH /api/projects/:id { name } -> { id, name }
export function renameProject(id, name) {
  return request(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  })
}

// DELETE /api/projects/:id -> 204. Conversations that were in the project
// aren't deleted, just un-tagged (they stay in history, ungrouped).
export function deleteProject(id) {
  return request(`/projects/${id}`, { method: "DELETE" })
}

// GET /api/auth/me -> { user: { id, name, email } } (401 when not logged in)
export function getMe() {
  return request("/auth/me")
}

// POST /api/auth/login { email, password } -> { user: { id, name, email } }
export function login({ email, password }) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

// POST /api/auth/register { name, email, password } -> { user: { id, name, email } }
export function register({ name, email, password }) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  })
}

// POST /api/auth/logout -> {}
export function logout() {
  return request("/auth/logout", { method: "POST" })
}
