import { BarChart3, Layers, Radar } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const HIGHLIGHTS = [
  {
    icon: Radar,
    title: "Find the right people",
    copy: "Pull verified contact addresses straight from the websites you care about.",
  },
  {
    icon: Layers,
    title: "Send in Smart Batches",
    copy: "Release your list in measured batches that protect your sender reputation.",
  },
  {
    icon: BarChart3,
    title: "Follow up on autopilot",
    copy: "Sequences pause the moment someone replies, so nobody gets chased twice.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl lg:grid-cols-[1.05fr_1fr]">
        <aside className="relative hidden overflow-hidden bg-slate-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-14">
          <div className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-indigo-600/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-40 -right-24 h-[26rem] w-[26rem] rounded-full bg-violet-500/20 blur-3xl" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]" />

          <div className="relative animate-rise">
            <Link
              href="/"
              className="inline-flex rounded-2xl bg-white p-3 shadow-xl shadow-black/30 transition hover:-translate-y-0.5"
            >
              <Image
                src="/mhenbulk-logo.png"
                alt="Mhenbulk — Send more. Reach more."
                width={190}
                height={135}
                priority
                className="h-auto w-40"
              />
            </Link>
            <h1 className="mt-12 max-w-lg text-4xl font-semibold leading-[1.1] tracking-tight">
              Cold lists in.
              <br />
              <span className="bg-gradient-to-r from-indigo-300 via-violet-200 to-white bg-clip-text text-transparent">
                Real replies out.
              </span>
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-300">
              Mhenbulk is the outreach desk for people who send from their own
              inbox — built to keep every send personal, paced, and accountable.
            </p>
          </div>

          <ul className="relative mt-12 space-y-3">
            {HIGHLIGHTS.map(({ icon: Icon, title, copy }) => (
              <li
                key={title}
                className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur transition hover:border-white/20 hover:bg-white/[0.07]"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-200 ring-1 ring-inset ring-indigo-400/30">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{copy}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="relative mt-12 text-sm text-slate-400">
            Your inbox, your contacts, your control — every workspace stays
            private to its owner.
          </p>
        </aside>

        <main className="relative flex items-center justify-center px-5 py-12 sm:px-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_110%_at_100%_0%,#eef2ff_0%,transparent_60%)]" />
          <div className="relative w-full max-w-md animate-rise">
            <Link href="/" className="mb-8 inline-flex lg:hidden">
              <Image
                src="/mhenbulk-logo.png"
                alt="Mhenbulk — Send more. Reach more."
                width={190}
                height={135}
                priority
                className="h-auto w-36"
              />
            </Link>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
