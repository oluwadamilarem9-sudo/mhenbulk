import Link from "next/link";

import { SITE_NAME } from "@/lib/site-config";

export function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`border-t border-slate-200 bg-white px-5 py-6 text-sm text-slate-600 sm:px-8 ${className}`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-slate-500">
          © {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
        </p>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href="/privacy-policy"
            className="font-medium text-slate-700 transition hover:text-indigo-600"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms-of-service"
            className="font-medium text-slate-700 transition hover:text-indigo-600"
          >
            Terms of Service
          </Link>
          <Link
            href="/login"
            className="font-medium text-slate-700 transition hover:text-indigo-600"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
