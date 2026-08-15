import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col lg:flex-row">
        <aside className="relative overflow-hidden bg-slate-950 px-8 py-10 text-white lg:w-[42%] lg:px-12 lg:py-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.35),_transparent_55%)]" />
          <div className="relative z-10 flex h-full flex-col justify-between gap-10">
            <div>
              <Link
                href="/"
                className="inline-flex rounded-2xl bg-white p-3 shadow-xl shadow-black/20"
              >
                <Image
                  src="/mhenbulk-logo.png"
                  alt="Mhenbulk — Send more. Reach more."
                  width={190}
                  height={135}
                  priority
                  className="h-auto w-40 sm:w-48"
                />
              </Link>
              <h1 className="mt-10 text-3xl font-semibold tracking-tight sm:text-4xl">
                Send campaigns with confidence.
              </h1>
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
                A production-ready foundation for contacts, campaigns, compliance, and
                gradual email delivery — built on Next.js and Supabase.
              </p>
            </div>
            <ul className="space-y-3 text-sm text-slate-300">
              <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                Ownership-scoped RLS for contacts and campaigns
              </li>
              <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                Queue-ready schema with pause/resume and retries
              </li>
              <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                Swappable email provider adapter
              </li>
            </ul>
          </div>
        </aside>

        <main className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}
