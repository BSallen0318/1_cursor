'use client';

import React from 'react';

export function LoadingIndicator({ label = '로딩 중...' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="p-6 rounded-xl border flex flex-col items-center justify-center gap-4 min-h-[140px]">
      <div className="text-base font-medium">
        <span className="loading-text">{label}</span>
      </div>
      <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div className="loading-bar h-full rounded-full" />
      </div>
      <style jsx>{`
        .loading-text { 
          display: inline-block;
          animation: scalePulse 1.2s ease-in-out infinite;
        }
        @keyframes scalePulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        .loading-bar {
          width: 40%;
          transform: translateX(-100%);
          animation: shimmer 1.1s linear infinite;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(82,82,91,0.0) 0%,
            rgba(82,82,91,0.35) 30%,
            rgba(82,82,91,0.0) 60%
          );
        }
        @media (prefers-color-scheme: dark) {
          .loading-bar {
            background: linear-gradient(
              90deg,
              transparent 0%,
              rgba(244,244,245,0.0) 0%,
              rgba(244,244,245,0.35) 30%,
              rgba(244,244,245,0.0) 60%
            );
          }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(160%); }
        }
      `}</style>
    </div>
  );
}


