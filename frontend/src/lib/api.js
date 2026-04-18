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
  updateProfile: (userId, data) => req(`/onboarding/profile/${userId}`, { method: 'PATCH', body: JSON.stringify(data) }),

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
  createTasks: (tasks) => req('/tasks/', { method: 'POST', body: JSON.stringify(tasks) }),
  getTasks: (courseId) => req(`/tasks/course/${courseId}`),
  getTodayTasks: (userId) => req(`/tasks/today/${userId}`),
  updateTaskStatus: (taskId, status) => req(`/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateTaskType: (taskId, task_type) => req(`/tasks/${taskId}/type`, { method: 'PATCH', body: JSON.stringify({ task_type }) }),
  deleteTask: (taskId) => req(`/tasks/${taskId}`, { method: 'DELETE' }),
  reorderTasks: (updates) => req('/tasks/reorder', { method: 'PATCH', body: JSON.stringify(updates) }),

  // ── Study / Pomodoro ──────────────────────────────────
  getTodayPlan: (userId) => req(`/study/today/${userId}`),
  getStats: (userId) => req(`/study/stats/${userId}`),
  startPomodoro: (data) => req('/study/pomodoro/start', { method: 'POST', body: JSON.stringify(data) }),
  completePomodoro: (sessionId, notes) => req('/study/pomodoro/complete', { method: 'POST', body: JSON.stringify({ session_id: sessionId, notes }) }),
  getSessions: (userId) => req(`/study/pomodoro/sessions/${userId}`),
  reschedule: (data) => req('/study/reschedule', { method: 'POST', body: JSON.stringify(data) }),
  reschedulePreview: (userId, feedback, options = {}) => req('/study/reschedule-preview', { method: 'POST', body: JSON.stringify({ user_id: userId, feedback, ...options }) }),
  fullReschedule: (userId, feedback, options = {}) => req('/study/full-reschedule', { method: 'POST', body: JSON.stringify({ user_id: userId, feedback, ...options }) }),

  // ── Flashcards ────────────────────────────────────────
  getFlashcardSets: (courseId, userId) => req(`/flashcards/sets/${courseId}?user_id=${userId}`),
  createFlashcardSet: (data) => req('/flashcards/sets', { method: 'POST', body: JSON.stringify(data) }),
  deleteFlashcardSet: (setId) => req(`/flashcards/sets/${setId}`, { method: 'DELETE' }),
  getFlashcards: (setId) => req(`/flashcards/${setId}`),
  addFlashcard: (data) => req('/flashcards/cards', { method: 'POST', body: JSON.stringify(data) }),
  updateFlashcard: (cardId, data) => req(`/flashcards/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFlashcard: (cardId) => req(`/flashcards/cards/${cardId}`, { method: 'DELETE' }),

  // ── Whiteboard ────────────────────────────────────────
  getWhiteboard: (courseId, userId) => req(`/whiteboard/${courseId}?user_id=${userId}`),
  saveWhiteboard: (data) => req('/whiteboard/save', { method: 'POST', body: JSON.stringify(data) }),
  chatOnNote: (data) => req('/whiteboard/chat', { method: 'POST', body: JSON.stringify(data) }),
  forkNote: (data) => req('/whiteboard/fork', { method: 'POST', body: JSON.stringify(data) }),
  extractSections: (pdfUrl) => req('/whiteboard/extract-sections', { method: 'POST', body: JSON.stringify({ pdf_url: pdfUrl }) }),

  // ── Gauntlet ──────────────────────────────────────────────────
  gauntletStart: (pdfUrl) => req('/tutor/start', { method: 'POST', body: JSON.stringify({ pdf_url: pdfUrl }) }),
  gauntletChat: (data) => req('/tutor/chat', { method: 'POST', body: JSON.stringify(data) }),
}
