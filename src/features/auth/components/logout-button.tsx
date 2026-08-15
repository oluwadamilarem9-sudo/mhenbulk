"use client";

import { LogOut } from "lucide-react";

import { logoutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";

type LogoutButtonProps = {
  className?: string;
  showLabel?: boolean;
};

export function LogoutButton({ className, showLabel = true }: LogoutButtonProps) {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant="ghost" size="sm" className={className}>
        <LogOut className="h-4 w-4" />
        {showLabel ? "Log out" : <span className="sr-only">Log out</span>}
      </Button>
    </form>
  );
}
