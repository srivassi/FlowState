'use client';

import { useState, useEffect } from 'react';

export default function Dashboard() {
  const [modules] = useState([
    { id: 1, name: 'Data Structures', date: '2 days ago' },
    { id: 2, name: 'Algorithms', date: '5 days ago' },
    { id: 3, name: 'Database Systems', date: '1 week ago' },
    { id: 4, name: 'Operating Systems', date: '2 weeks ago' },
  ]);

  const [selectedModule, setSelectedModule] = useState(null);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-gray-200 bg-white p-4 shadow-xl">
        <div className="mb-6 flex-1">
          <h2 className="mb-4 text-sm font-semibold text-gray-500">STUDY HISTORY</h2>
          <div className="space-y-1">
            {modules.map((module) => (
              <div
                key={module.id}
                onClick={() => setSelectedModule(module)}
                className={`cursor-pointer rounded-lg px-3 py-2 text-sm shadow-md transition ${
                  selectedModule?.id === module.id
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/30'
                    : 'bg-gradient-to-r from-gray-100 to-gray-50 text-gray-700 hover:from-gray-200 hover:to-gray-100 hover:shadow-lg'
                }`}
              >
                <div className="font-medium">📚 {module.name}</div>
                <div className={`text-xs ${selectedModule?.id === module.id ? 'text-blue-100' : 'text-gray-500'}`}>{module.date}</div>
              </div>
            ))}
          </div>
        </div>
        
        <button 
          onClick={() => setSelectedModule(null)}
          className="mb-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-md transition hover:bg-gray-50 hover:shadow-lg"
        >
          ← Back to Overview
        </button>

        {/* Pomodoro Timer */}
        <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-red-50 p-4 shadow-xl">
          <div className="mb-3 text-center text-xs font-semibold text-orange-600">FOCUS SESSION</div>
          
          <div className="mb-3 flex justify-center">
            <div className="text-5xl drop-shadow-lg">⏳</div>
          </div>
          
          <div className="mb-4 text-center">
            <div className="text-3xl font-bold text-gray-800 drop-shadow-sm">
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </div>
            <div className="mt-1 text-xs text-orange-600">25 min session</div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={() => setIsRunning(!isRunning)}
              className="flex-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition hover:from-red-600 hover:to-orange-600 hover:shadow-xl"
            >
              {isRunning ? 'Pause' : 'Start'}
            </button>
            <button
              onClick={() => { setTimeLeft(25 * 60); setIsRunning(false); }}
              className="rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm text-orange-600 transition hover:bg-orange-50"
            >
              Reset
            </button>
          </div>
          
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-orange-100">
            <div
              className="h-full bg-gradient-to-r from-red-500 to-orange-500 shadow-lg transition-all duration-1000"
              style={{ width: `${((25 * 60 - timeLeft) / (25 * 60)) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-12">
          {!selectedModule ? (
            <>
              <div className="mb-8">
                <h1 className="mb-2 bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-clip-text text-4xl font-bold text-transparent drop-shadow-sm">Welcome back</h1>
                <p className="text-gray-600">🔥 Keep your streak going! 5 days strong</p>
              </div>

              {/* Productivity & Progress Stats */}
              <div className="mb-8 grid grid-cols-4 gap-4">
                <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-6 shadow-xl">
                  <div className="mb-2 text-3xl">🎯</div>
                  <div className="text-2xl font-bold text-gray-800">12</div>
                  <div className="text-xs text-gray-600">Tasks Completed</div>
                </div>
                <div className="rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50 p-6 shadow-xl">
                  <div className="mb-2 text-3xl">⏱️</div>
                  <div className="text-2xl font-bold text-gray-800">48h</div>
                  <div className="text-xs text-gray-600">Focus Time</div>
                </div>
                <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 p-6 shadow-xl">
                  <div className="mb-2 text-3xl">🔥</div>
                  <div className="text-2xl font-bold text-gray-800">5</div>
                  <div className="text-xs text-gray-600">Day Streak</div>
                </div>
                <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-6 shadow-xl">
                  <div className="mb-2 text-3xl">🏆</div>
                  <div className="text-2xl font-bold text-gray-800">8</div>
                  <div className="text-xs text-gray-600">Badges Earned</div>
                </div>
              </div>

              {/* Weekly Progress Overview */}
              <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
                <h2 className="mb-4 text-lg font-semibold text-gray-800">📈 Weekly Progress Overview</h2>
                <div className="mb-4 flex items-end justify-between gap-2">
                  {[40, 65, 55, 80, 70, 45, 60].map((height, idx) => (
                    <div key={idx} className="flex flex-1 flex-col items-center gap-2">
                      <div className="w-full rounded-t-lg bg-gradient-to-t from-blue-500 to-cyan-400 shadow-lg" style={{ height: `${height}px` }}></div>
                      <div className="text-xs text-gray-500">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][idx]}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-gray-600">This week: <span className="font-semibold text-gray-800">18 Pomodoros</span></div>
                  <div className="text-green-600">↑ 12% from last week</div>
                </div>
              </div>

              {/* Smart Study Calendar */}
              <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-800">📅 Smart Study Plan & Calendar</h2>
                  <button className="text-sm text-blue-600 transition hover:text-blue-700">View All →</button>
                </div>
                
                <div className="overflow-x-auto">
                  <div className="flex gap-3 pb-2">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
                      <div
                        key={day}
                        className="min-w-[140px] cursor-pointer rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4 shadow-lg transition hover:border-gray-300 hover:shadow-xl"
                      >
                        <div className="mb-2 text-xs font-semibold text-gray-500">{day}</div>
                        <div className="mb-3 text-sm font-bold text-gray-800">Feb {10 + idx}</div>
                        <div className="space-y-2">
                          <div className="rounded bg-gradient-to-r from-cyan-100 to-blue-100 px-2 py-1 text-xs text-cyan-700 shadow-md">
                            9:00 AM - Study
                          </div>
                          <div className="rounded bg-gradient-to-r from-green-100 to-emerald-100 px-2 py-1 text-xs text-green-700 shadow-md">
                            2:00 PM - Review
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-cyan-500 shadow-lg"></div>
                    <span>Study Session</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500 shadow-lg"></div>
                    <span>Review</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-yellow-500 shadow-lg"></div>
                    <span>Buffer Time</span>
                  </div>
                </div>
              </div>

              {/* Recent Activity */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
                <h2 className="mb-4 text-lg font-semibold text-gray-800">Recent Activity</h2>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">✅</div>
                    <div>
                      <div className="font-medium text-gray-800">Completed Data Structures</div>
                      <div className="text-sm text-gray-500">2 days ago</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">📝</div>
                    <div>
                      <div className="font-medium text-gray-800">Started Algorithms module</div>
                      <div className="text-sm text-gray-500">5 days ago</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">🎯</div>
                    <div>
                      <div className="font-medium text-gray-800">Set new study goal</div>
                      <div className="text-sm text-gray-500">1 week ago</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Module Dashboard */}
              <div className="mb-8">
                <h1 className="mb-2 bg-gradient-to-r from-blue-600 via-cyan-600 to-blue-600 bg-clip-text text-4xl font-bold text-transparent drop-shadow-sm">{selectedModule.name}</h1>
                <p className="text-gray-600">Module progress and insights</p>
              </div>

              {/* Module Stats */}
              <div className="mb-8 grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-6 shadow-xl">
                  <div className="mb-2 text-3xl">📖</div>
                  <div className="text-2xl font-bold text-gray-800">8/12</div>
                  <div className="text-xs text-gray-600">Topics Completed</div>
                </div>
                <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 p-6 shadow-xl">
                  <div className="mb-2 text-3xl">⏱️</div>
                  <div className="text-2xl font-bold text-gray-800">12h</div>
                  <div className="text-xs text-gray-600">Time Spent</div>
                </div>
                <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 p-6 shadow-xl">
                  <div className="mb-2 text-3xl">✅</div>
                  <div className="text-2xl font-bold text-gray-800">85%</div>
                  <div className="text-xs text-gray-600">Completion</div>
                </div>
              </div>

              {/* Module Calendar */}
              <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
                <h2 className="mb-4 text-lg font-semibold text-gray-800">📅 Study Schedule</h2>
                <div className="overflow-x-auto">
                  <div className="flex gap-3 pb-2">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, idx) => (
                      <div
                        key={day}
                        className="min-w-[140px] cursor-pointer rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4 shadow-lg transition hover:shadow-xl"
                      >
                        <div className="mb-2 text-xs font-semibold text-gray-500">{day}</div>
                        <div className="mb-3 text-sm font-bold text-gray-800">Feb {10 + idx}</div>
                        <div className="space-y-2">
                          <div className="rounded bg-gradient-to-r from-blue-100 to-cyan-100 px-2 py-1 text-xs text-blue-700 shadow-md">
                            Topic {idx + 1}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Flashcards Button */}
              <div className="mb-8 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 p-6 shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="mb-1 text-lg font-semibold text-gray-800">🎴 Flashcards</h2>
                    <p className="text-sm text-gray-600">24 cards due for review</p>
                  </div>
                  <button className="rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-3 font-semibold text-white shadow-lg shadow-purple-500/30 transition hover:from-purple-600 hover:to-pink-600 hover:shadow-xl">
                    View Flashcards
                  </button>
                </div>
              </div>

              {/* Module Activity */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
                <h2 className="mb-4 text-lg font-semibold text-gray-800">Recent Activity</h2>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">✅</div>
                    <div>
                      <div className="font-medium text-gray-800">Completed Topic 8: Hash Tables</div>
                      <div className="text-sm text-gray-500">1 day ago</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">📝</div>
                    <div>
                      <div className="font-medium text-gray-800">Reviewed 15 flashcards</div>
                      <div className="text-sm text-gray-500">2 days ago</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">🎯</div>
                    <div>
                      <div className="font-medium text-gray-800">Started Topic 7: Trees</div>
                      <div className="text-sm text-gray-500">3 days ago</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
