"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { SidebarNav } from "@/components/layout/sidebar-nav";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { Button } from "@/components/ui/button";

type AppShellProps = {
  children: React.ReactNode;
  userEmail: string;
  userName: string | null;
};

export function AppShell({ children, userEmail, userName }: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-5">
            <Link href="/dashboard" className="inline-flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
                MB
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">Mhenbulk</p>
                <p className="text-xs text-slate-500">Email campaigns</p>
              </div>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarNav pathname={pathname} />
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2">
              <p className="truncate text-sm font-medium text-slate-900">
                {userName || "Account"}
              </p>
              <p className="truncate text-xs text-slate-500">{userEmail}</p>
            </div>
            <LogoutButton className="w-full justify-start" />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
            <Link href="/dashboard" className="inline-flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
                MB
              </span>
              <span className="text-sm font-semibold text-slate-900">Mhenbulk</span>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </header>

          {mobileOpen ? (
            <div className="border-b border-slate-200 bg-white px-4 py-4 lg:hidden">
              <SidebarNav
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="truncate text-sm font-medium text-slate-900">
                  {userName || "Account"}
                </p>
                <p className="mb-3 truncate text-xs text-slate-500">{userEmail}</p>
                <LogoutButton />
              </div>
            </div>
          ) : null}

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
