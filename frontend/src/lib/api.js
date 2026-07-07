const BASE = "/api"

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
  return res.json()
}

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
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

// POST /api/chat { message, model, conversationId?, projectId?, attachments? }
// -> { conversationId, message: { role: "assistant", content, model } }
// When attachments are present, sent as multipart/form-data instead of JSON.
export function sendMessage({ message, model, conversationId, projectId, attachments }) {
  if (attachments && attachments.length > 0) {
    const form = new FormData()
    form.append("message", message)
    form.append("model", model)
    if (conversationId) form.append("conversationId", conversationId)
    if (projectId) form.append("projectId", projectId)
    for (const file of attachments) form.append("attachments", file)

    return fetch(`${BASE}/chat`, { method: "POST", body: form }).then(handleResponse)
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
