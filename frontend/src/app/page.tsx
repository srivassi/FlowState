'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleLogin = () => {
    router.push('/dashboard');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#191919]">
      <div className="w-full max-w-md px-6">
        <div className="mb-12 text-center">
          <div className="mb-4 text-5xl">📚</div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">
            Study Planner
          </h1>
          <p className="text-base text-zinc-400">
            Your AI-powered academic coach
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-semibold text-zinc-200">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="w-full rounded-lg border border-zinc-700 bg-[#2D2D2D] px-4 py-3 text-white placeholder-zinc-500 transition focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-zinc-200">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full rounded-lg border border-zinc-700 bg-[#2D2D2D] px-4 py-3 text-white placeholder-zinc-500 transition focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          <button onClick={handleLogin} className="w-full rounded-lg bg-white py-3 font-semibold text-black transition hover:bg-zinc-200">
            Continue
          </button>

          <button className="w-full text-sm text-zinc-400 transition hover:text-zinc-300">
            Forgot password?
          </button>
        </div>

        <div className="my-8 flex items-center">
          <div className="flex-1 border-t border-zinc-700"></div>
          <span className="px-4 text-sm font-medium text-zinc-500">OR</span>
          <div className="flex-1 border-t border-zinc-700"></div>
        </div>

        <div className="space-y-3">
          <button className="w-full rounded-lg border border-zinc-700 bg-[#2D2D2D] py-3 font-medium text-zinc-200 transition hover:bg-[#3D3D3D]">
            Continue with Google
          </button>
          <button className="w-full rounded-lg border border-zinc-700 bg-[#2D2D2D] py-3 font-medium text-zinc-200 transition hover:bg-[#3D3D3D]">
            Continue with Apple
          </button>
        </div>

        <div className="mt-8 text-center text-sm">
          <span className="text-zinc-400">Don't have an account? </span>
          <button className="font-semibold text-white hover:underline">
            Sign up
          </button>
        </div>
      </div>
    </div>
  );
}
