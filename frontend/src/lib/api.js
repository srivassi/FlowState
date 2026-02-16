const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const api = {
  async completeOnboarding(data) {
    const res = await fetch(`${API_URL}/onboarding/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return res.json()
  },

  async getUserProfile(userId) {
    const res = await fetch(`${API_URL}/onboarding/profile/${userId}`)
    return res.json()
  },

  async parseSyllabus(file) {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${API_URL}/agent/parse-syllabus`, {
      method: 'POST',
      body: formData
    })
    return res.json()
  },

  async generatePlan(data) {
    const res = await fetch(`${API_URL}/agent/generate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return res.json()
  },

  async getTasks(courseId) {
    const res = await fetch(`${API_URL}/tasks/course/${courseId}`)
    return res.json()
  },

  async createTasks(tasks) {
    const res = await fetch(`${API_URL}/tasks/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tasks)
    })
    return res.json()
  },

  async getStudySessions(userId) {
    const res = await fetch(`${API_URL}/study/sessions/${userId}`)
    return res.json()
  },

  async startPomodoro(data) {
    const res = await fetch(`${API_URL}/study/pomodoro/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return res.json()
  },

  async completePomodoro(sessionId) {
    const res = await fetch(`${API_URL}/study/pomodoro/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId })
    })
    return res.json()
  }
}
