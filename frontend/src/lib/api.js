const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function req(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

export const api = {
  // ── Onboarding ──────────────────────────────────────
  completeOnboarding: (data) => req('/onboarding/complete', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: (userId) => req(`/onboarding/profile/${userId}`),

  // ── Courses ──────────────────────────────────────────
  createCourse: (data) => req('/onboarding/courses', { method: 'POST', body: JSON.stringify(data) }),
  getCourses: (userId) => req(`/onboarding/courses/${userId}`),
  deleteCourse: (courseId) => req(`/onboarding/courses/${courseId}`, { method: 'DELETE' }),

  // ── Disruptions ──────────────────────────────────────
  createDisruption: (data) => req('/onboarding/disruptions', { method: 'POST', body: JSON.stringify(data) }),
  getDisruptions: (userId) => req(`/onboarding/disruptions/${userId}`),
  deleteDisruption: (id) => req(`/onboarding/disruptions/${id}`, { method: 'DELETE' }),

  // ── Agent ─────────────────────────────────────────────
  generatePlan: (data) => req('/agent/generate-plan', { method: 'POST', body: JSON.stringify(data) }),

  // ── Tasks ─────────────────────────────────────────────
  getTasks: (courseId) => req(`/tasks/course/${courseId}`),
  getTodayTasks: (userId) => req(`/tasks/today/${userId}`),
  updateTaskStatus: (taskId, status) => req(`/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteTask: (taskId) => req(`/tasks/${taskId}`, { method: 'DELETE' }),
  reorderTasks: (updates) => req('/tasks/reorder', { method: 'PATCH', body: JSON.stringify(updates) }),

  // ── Study / Pomodoro ──────────────────────────────────
  getTodayPlan: (userId) => req(`/study/today/${userId}`),
  getStats: (userId) => req(`/study/stats/${userId}`),
  startPomodoro: (data) => req('/study/pomodoro/start', { method: 'POST', body: JSON.stringify(data) }),
  completePomodoro: (sessionId, notes) => req('/study/pomodoro/complete', { method: 'POST', body: JSON.stringify({ session_id: sessionId, notes }) }),
  getSessions: (userId) => req(`/study/pomodoro/sessions/${userId}`),
  reschedule: (data) => req('/study/reschedule', { method: 'POST', body: JSON.stringify(data) }),

  // ── Whiteboard ────────────────────────────────────────
  getWhiteboard: (courseId, userId) => req(`/whiteboard/${courseId}?user_id=${userId}`),
  saveWhiteboard: (data) => req('/whiteboard/save', { method: 'POST', body: JSON.stringify(data) }),
  chatOnNote: (data) => req('/whiteboard/chat', { method: 'POST', body: JSON.stringify(data) }),
  forkNote: (data) => req('/whiteboard/fork', { method: 'POST', body: JSON.stringify(data) }),
}
