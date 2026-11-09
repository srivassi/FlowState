import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const source = await readFile(new URL('../src/lib/api.js', import.meta.url), 'utf8')
const { api } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('API errors retain useful FastAPI validation fields without input values', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({ detail: [
      { loc: ['query', 'user_id'], msg: 'Field required', input: 'private-content' },
    ] }) })
    await assert.rejects(api.gauntletGetRooms('student'), { message: 'query.user_id: Field required' })
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ detail: 'Topic extraction failed' }) })
    await assert.rejects(api.gauntletStart('notes.pdf'), { message: 'Topic extraction failed' })
    globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => { throw Error('not json') } })
    await assert.rejects(api.gauntletStart('notes.pdf'), { message: 'Request failed (HTTP 502)' })
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ topics: ['Cells'] }) })
    assert.deepEqual(await api.gauntletStart('notes.pdf'), { topics: ['Cells'] })
  } finally { globalThis.fetch = originalFetch }
})

test('GoF calls match deployed body and query contracts', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({}) } }
    await api.gauntletStart('https://example.test/notes.pdf', 'room1')
    await api.gauntletGetRooms('student1', 'course1')
    await api.gauntletGetProgress('room1', 'student1')
    assert.ok(calls[0].url.endsWith('/tutor/start'))
    assert.equal(calls[0].options.method, 'POST')
    assert.deepEqual(JSON.parse(calls[0].options.body), { pdf_url: 'https://example.test/notes.pdf', room_id: 'room1' })
    assert.equal(new URL(calls[1].url).searchParams.get('user_id'), 'student1')
    assert.equal(new URL(calls[2].url).searchParams.get('user_id'), 'student1')
  } finally { globalThis.fetch = originalFetch }
})
