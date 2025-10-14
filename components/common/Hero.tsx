export function Hero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-950">
      <div className="pointer-events-none absolute -top-20 -left-20 h-64 w-64 rounded-full bg-fuchsia-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-sky-500/30 blur-3xl" />
      <div className="relative p-8 md:p-10">
        <h1 className="text-2xl md:text-3xl font-semibold leading-tight">
          <span className="bg-gradient-to-r from-fuchsia-600 to-sky-500 bg-clip-text text-transparent">
            {title}
          </span>
        </h1>
        {subtitle ? (
          <p className="mt-2 text-sm md:text-base text-zinc-600 dark:text-zinc-400">{subtitle}</p>
        ) : null}
        {/* Crying doodles (남/여) */}
        <div className="pointer-events-none absolute right-6 top-4 hidden sm:block opacity-80">
          <svg
            width="180"
            height="110"
            viewBox="0 0 180 110"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-zinc-700/60 dark:text-zinc-200/60"
            aria-hidden
          >
            {/* Male head */}
            <circle cx="55" cy="55" r="24" stroke="currentColor" strokeWidth="2.5" />
            {/* Male hair */}
            <path d="M38 52c2-14 32-22 36-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            {/* Male eyes */}
            <path d="M45 58c3-4 7-4 10 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M60 58c3-4 7-4 10 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            {/* Male mouth */}
            <path d="M50 70c4 3 8 3 12 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            {/* Male tears */}
            <path d="M58 62c0 6-4 9-4 12" stroke="#0ea5e9" strokeWidth="3" strokeLinecap="round"/>

            {/* Female head */}
            <circle cx="125" cy="55" r="24" stroke="currentColor" strokeWidth="2.5" />
            {/* Bun hair */}
            <circle cx="137" cy="35" r="8" stroke="currentColor" strokeWidth="2.5" />
            {/* Female eyes */}
            <path d="M115 58c3-4 7-4 10 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M130 58c3-4 7-4 10 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            {/* Female mouth (wavy) */}
            <path d="M118 69c2 3 12 3 14 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            {/* Female tears */}
            <path d="M132 62c0 7-5 10-5 13" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </section>
  );
}


