import Link from "next/link";
import {
  Handshake,
  LayoutDashboard,
  Mail,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const APP_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/email-finder", label: "Email Finder", icon: Search },
  { href: "/partner-extractor", label: "Partner Extractor", icon: Handshake },
  { href: "/campaigns", label: "Campaigns", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
];

type SidebarNavProps = {
  pathname: string;
  onNavigate?: () => void;
  className?: string;
};

export function SidebarNav({ pathname, onNavigate, className }: SidebarNavProps) {
  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      {APP_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "inline-flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              active
                ? "bg-indigo-50 text-indigo-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
