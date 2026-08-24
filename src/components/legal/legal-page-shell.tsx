import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/legal/site-footer";
import { LEGAL_LAST_UPDATED, SITE_NAME, SITE_TAGLINE } from "@/lib/site-config";

type Props = {
  title: string;
  children: React.ReactNode;
};

export function LegalPageShell({ title, children }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/login" className="inline-flex items-center gap-3">
            <Image
              src="/mhenbulk-logo.png"
              alt={`${SITE_NAME} — ${SITE_TAGLINE}`}
              width={140}
              height={100}
              className="h-auto w-28"
            />
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-indigo-600 transition hover:text-indigo-500"
          >
            Back to Mhenbulk
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
          <p className="text-sm font-medium text-slate-500">
            Last updated: {LEGAL_LAST_UPDATED}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {title}
          </h1>
          <div className="mt-8 space-y-6 text-base leading-7 text-slate-700 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-slate-900 [&_a]:font-medium [&_a]:text-indigo-600 [&_a]:hover:text-indigo-500 [&_a]:hover:underline [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
            {children}
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
