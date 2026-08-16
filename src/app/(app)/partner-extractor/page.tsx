import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Download,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

const PARTNER_EXTRACTOR_URL = "https://url-email-whisperer.lovable.app/";

export const metadata = {
  title: "Partner Extractor",
  description:
    "Use our partner bulk extractor to discover publicly listed business emails from website URLs.",
};

const benefits = [
  {
    icon: SearchCheck,
    title: "Deep website crawl",
    description: "Checks contact, about, policy, and other useful pages.",
  },
  {
    icon: BadgeCheck,
    title: "Owner-grade results",
    description: "Filter generic and low-confidence addresses from your results.",
  },
  {
    icon: Download,
    title: "Easy CSV export",
    description: "Download a clean list that is ready for your outreach workflow.",
  },
];

export default function PartnerExtractorPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
            <Sparkles className="h-3.5 w-3.5" />
            Partner tool
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Partner Extractor
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Paste website URLs and use Hamruf-pro to find publicly listed business
            emails in bulk.
          </p>
        </div>

        <a
          href={PARTNER_EXTRACTOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500"
        >
          Open in a new tab
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {benefits.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardContent className="flex gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Hamruf-pro Extractor</p>
            <p className="text-xs text-slate-500">
              The partner service is displayed securely inside Mhenbulk.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            Public business data only
          </div>
        </div>

        <iframe
          src={PARTNER_EXTRACTOR_URL}
          title="Hamruf-pro partner email extractor"
          className="h-[760px] w-full bg-white sm:h-[820px]"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          allow="clipboard-read; clipboard-write"
        />
      </Card>

      <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Use extracted addresses responsibly and follow privacy, consent, and
          anti-spam laws that apply to your outreach.
        </p>
        <Link
          href="/email-finder"
          className="shrink-0 font-semibold text-amber-950 underline underline-offset-2"
        >
          Use Mhenbulk Email Finder
        </Link>
      </div>
    </div>
  );
}
