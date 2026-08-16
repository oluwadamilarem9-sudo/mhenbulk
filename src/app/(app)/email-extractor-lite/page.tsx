import {
  ArrowUpRight,
  Copy,
  Filter,
  Layers3,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

const EMAIL_EXTRACTOR_LITE_URL = "https://eel.surf7.net.my/";

export const metadata = {
  title: "Email Extractor Lite",
  description:
    "Extract, clean, filter, and group email addresses from pasted text with our Surf7.net partner tool.",
};

const benefits = [
  {
    icon: Copy,
    title: "Paste and extract",
    description: "Turn unstructured text into a clean list of unique addresses.",
  },
  {
    icon: Filter,
    title: "Filter your results",
    description: "Include or exclude addresses using a word or domain.",
  },
  {
    icon: Layers3,
    title: "Format and group",
    description: "Sort, normalize, separate, and split results into useful groups.",
  },
];

export default function EmailExtractorLitePage() {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl shadow-slate-900/10 sm:px-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-indigo-100 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Partner utility
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Email Extractor Lite
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Paste any block of text and instantly pull out unique email
              addresses. Clean, filter, group, and copy the results into your
              Mhenbulk workflow.
            </p>
          </div>
          <a
            href={EMAIL_EXTRACTOR_LITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-indigo-50"
          >
            Open full screen
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {benefits.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardContent className="flex gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  {description}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden shadow-lg shadow-slate-900/5">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Surf7.net Email Extractor Lite
            </p>
            <p className="text-xs text-slate-500">
              The original partner utility is displayed inside your Mhenbulk
              workspace.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            No text is stored by Mhenbulk
          </div>
        </div>

        <iframe
          src={EMAIL_EXTRACTOR_LITE_URL}
          title="Surf7.net Email Extractor Lite"
          className="h-[780px] w-full bg-white sm:h-[860px]"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write"
        />
      </Card>

      <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Use extracted addresses responsibly. Only contact people where you
          have a lawful reason, and follow applicable privacy and anti-spam
          rules.
        </p>
        <a
          href="https://www.surf7.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 font-semibold text-amber-950 underline underline-offset-2"
        >
          Powered by Surf7.net
        </a>
      </div>
    </div>
  );
}
