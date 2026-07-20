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

// DELETE /api/history/:id -> 204
export function deleteConversation(id) {
  return request(`/history/${id}`, { method: "DELETE" })
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

// POST /api/chat { message, model, conversationId?, projectId?, screenContext?, browsingEnabled? } -> raw Response.
// projectId only matters when starting a brand-new conversation (no
// conversationId) - it tags that conversation into the project. screenContext
// is a plain-text screen-share description (see useChat.js's send()) - the
// backend folds it into the message it sends to the model as invisible
// background context; it's never stored or shown, so it isn't echoed back
// anywhere in this response. browsingEnabled is the Composer's "Browse web"
// toggle - true nudges the model to actually use a tool this turn instead
// of leaving it entirely up to its own judgment (see routes/chat.js).
// The backend picks one of two response shapes depending on the model (see
// backend src/utils/modelMode.js):
//  - stream mode: 200, Content-Type text/plain, body is raw text chunks, and
//    an X-Conversation-Id header carries the (possibly brand-new) conversation id.
//  - job mode: 200 JSON { mode: "job", jobId, status, statusUrl, conversationId }
// Callers must branch on response.headers.get("content-type") themselves -
// this stays unparsed so streaming callers can read response.body directly.
export function postChat({ message, model, conversationId, projectId, screenContext, browsingEnabled }) {
  return fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      message,
      model,
      ...(conversationId ? { conversationId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(screenContext ? { screenContext } : {}),
      ...(browsingEnabled ? { browsingEnabled: true } : {}),
    }),
  })
}

const VISION_POLL_INTERVAL_MS = 1500
const VISION_MAX_POLLS = 60 // ~90s ceiling - matches roughly what the vision model should need on this hardware

// POST /api/vision { image: <base64 jpeg, no data: prefix>, conversationId, question? }
// -> { jobId, statusUrl }
// GET /api/vision/jobs/:jobId -> { status, description?, error? }
// Vision inference is slow enough that the backend runs it as a background
// job rather than holding the request open - this submits and polls until
// the job resolves, keeping the external contract (an awaited promise
// resolving to { description }) the same for callers like ScreenShareButton.jsx.
export async function sendScreenCapture({ image, conversationId, question }) {
  const { jobId } = await request("/vision", {
    method: "POST",
    body: JSON.stringify({ image, conversationId, question }),
  })

  for (let i = 0; i < VISION_MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, VISION_POLL_INTERVAL_MS))
    const job = await request(`/vision/jobs/${jobId}`)
    if (job.status === "done") return { description: job.description }
    if (job.status === "error") throw new Error(job.error || "Vision job failed")
  }
  throw new Error("Vision job timed out waiting for a result")
}

// GET /api/chat/jobs/:jobId -> { jobId, status, model, thinking, partial? | answer? | error? }
// thinking is always present (may be "") - a thinking-capable model's
// reasoning trace, streamed in before partial/answer since Ollama sends
// thinking tokens first. No selectable model currently populates it.
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

// GET /api/usage/summary -> { totals: {today, week, month, allTime}, daily: [{date, vision, browsing, total}] }
// costUsd figures throughout - vision/browsing OpenAI spend, whole-app (not per-user).
export function getUsageSummary() {
  return request("/usage/summary")
}

// POST /api/documents/upload (multipart) -> { sourceFileName, chunkCount }
// Chunked, embedded, and indexed for POST /api/chat's search_documents tool -
// see backend src/routes/documents.js. Bypasses request()/JSON since this is
// a file upload, same pattern as the legacy multipart path in sendMessage above.
export function uploadDocument(file) {
  const form = new FormData()
  form.append("file", file)
  return fetch(`${BASE}/documents/upload`, { method: "POST", body: form, credentials: "include" }).then(
    handleResponse
  )
}

// GET /api/documents -> [{ sourceFileName, chunkCount, uploadedAt }], most recent first
export function getDocuments() {
  return request("/documents")
}

// DELETE /api/documents/:sourceFileName -> 204
export function deleteDocument(sourceFileName) {
  return request(`/documents/${encodeURIComponent(sourceFileName)}`, { method: "DELETE" })
}

// POST /api/voice/transcribe (multipart) -> { text }
export function transcribeAudio(blob) {
  const form = new FormData()
  form.append("audio", blob, "recording.webm")
  return fetch(`${BASE}/voice/transcribe`, { method: "POST", body: form, credentials: "include" }).then(
    handleResponse
  )
}

// POST /api/voice/speak { text } -> raw Response, body is audio/wav bytes.
// Left unparsed (like postChat) so the caller can read it as a Blob itself.
export function speakText(text) {
  return fetch(`${BASE}/voice/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ text }),
  })
}

// GET /api/admin/apis -> [ApiRegistry], approved entries regardless of
// their enabled on/off toggle
export function getApis() {
  return request("/admin/apis")
}

// GET /api/admin/apis/pending -> [ApiRegistry], status: "pending"
export function getPendingApis() {
  return request("/admin/apis/pending")
}

// POST /api/admin/apis { name, description, baseUrl, path, method?, params?, authType?, authEnvVar?, authKeyName? }
// -> ApiRegistry. Manual entries save straight to status: "approved" - the
// human filling out this form IS the approval.
export function createApi(draft) {
  return request("/admin/apis", { method: "POST", body: JSON.stringify(draft) })
}

// PATCH /api/admin/apis/:id { ...any editable field } -> ApiRegistry
export function updateApi(id, updates) {
  return request(`/admin/apis/${id}`, { method: "PATCH", body: JSON.stringify(updates) })
}

// POST /api/admin/apis/:id/approve { ...optional field overrides } -> ApiRegistry
export function approveApi(id, overrides) {
  return request(`/admin/apis/${id}/approve`, { method: "POST", body: JSON.stringify(overrides || {}) })
}

// POST /api/admin/apis/:id/reject -> ApiRegistry
export function rejectApi(id) {
  return request(`/admin/apis/${id}/reject`, { method: "POST" })
}

// DELETE /api/admin/apis/:id -> 204
export function deleteApi(id) {
  return request(`/admin/apis/${id}`, { method: "DELETE" })
}

// POST /api/admin/apis/bulk-approve-eligible -> { approvedCount, approvedNames, skippedCount }
export function bulkApproveEligibleApis() {
  return request("/admin/apis/bulk-approve-eligible", { method: "POST" })
}

// POST /api/admin/apis/bulk-enable-category { category } -> { enabledCount, enabledNames }
export function bulkEnableCategoryApis(category) {
  return request("/admin/apis/bulk-enable-category", {
    method: "POST",
    body: JSON.stringify({ category }),
  })
}
