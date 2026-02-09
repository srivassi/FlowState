'use client';

import { useState } from 'react';

export default function Dashboard() {
  const [modules] = useState([
    { id: 1, name: 'Data Structures', date: '2 days ago' },
    { id: 2, name: 'Algorithms', date: '5 days ago' },
    { id: 3, name: 'Database Systems', date: '1 week ago' },
    { id: 4, name: 'Operating Systems', date: '2 weeks ago' },
  ]);

  return (
    <div className="flex h-screen bg-[#191919]">
      {/* Sidebar */}
      <div className="w-64 border-r border-zinc-800 bg-[#1F1F1F] p-4">
        <div className="mb-6">
          <h2 className="mb-4 text-sm font-semibold text-zinc-400">STUDY HISTORY</h2>
          <div className="space-y-1">
            {modules.map((module) => (
              <div
                key={module.id}
                className="cursor-pointer rounded-md px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
              >
                <div className="font-medium">📚 {module.name}</div>
                <div className="text-xs text-zinc-500">{module.date}</div>
              </div>
            ))}
          </div>
        </div>
        
        <button className="mt-4 w-full rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800">
          + New Module
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-12">
          <div className="mb-8">
            <h1 className="mb-2 text-4xl font-bold text-white">Welcome back</h1>
            <p className="text-zinc-400">Continue your learning journey</p>
          </div>

          {/* Stats Cards */}
          <div className="mb-8 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-800 bg-[#1F1F1F] p-6">
              <div className="text-2xl font-bold text-white">12</div>
              <div className="text-sm text-zinc-400">Modules Completed</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-[#1F1F1F] p-6">
              <div className="text-2xl font-bold text-white">48h</div>
              <div className="text-sm text-zinc-400">Study Time</div>
            </div>
          </div>

          {/* Smart Study Calendar */}
          <div className="mb-8 rounded-lg border border-zinc-800 bg-[#1F1F1F] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">📅 Smart Study Plan & Calendar</h2>
              <button className="text-sm text-zinc-400 hover:text-white">View All →</button>
            </div>
            
            {/* Horizontal Scrollable Calendar */}
            <div className="overflow-x-auto">
              <div className="flex gap-3 pb-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
                  <div
                    key={day}
                    className="min-w-[140px] cursor-pointer rounded-lg border border-zinc-700 bg-[#2D2D2D] p-4 transition hover:border-zinc-600"
                  >
                    <div className="mb-2 text-xs font-semibold text-zinc-400">{day}</div>
                    <div className="mb-3 text-sm font-bold text-white">Feb {10 + idx}</div>
                    <div className="space-y-2">
                      <div className="rounded bg-blue-900/30 px-2 py-1 text-xs text-blue-300">
                        9:00 AM - Study
                      </div>
                      <div className="rounded bg-green-900/30 px-2 py-1 text-xs text-green-300">
                        2:00 PM - Review
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="mt-4 flex items-center gap-4 text-xs text-zinc-500">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                <span>Study Session</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <span>Review</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-yellow-500"></div>
                <span>Buffer Time</span>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="rounded-lg border border-zinc-800 bg-[#1F1F1F] p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Recent Activity</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="text-2xl">✅</div>
                <div>
                  <div className="font-medium text-white">Completed Data Structures</div>
                  <div className="text-sm text-zinc-400">2 days ago</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="text-2xl">📝</div>
                <div>
                  <div className="font-medium text-white">Started Algorithms module</div>
                  <div className="text-sm text-zinc-400">5 days ago</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="text-2xl">🎯</div>
                <div>
                  <div className="font-medium text-white">Set new study goal</div>
                  <div className="text-sm text-zinc-400">1 week ago</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
