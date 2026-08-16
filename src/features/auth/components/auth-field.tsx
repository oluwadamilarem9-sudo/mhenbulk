"use client";

import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { type InputHTMLAttributes, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: LucideIcon;
  error?: string;
  /** Adds a reveal toggle and starts masked. */
  reveal?: boolean;
};

export function AuthField({
  label,
  icon: Icon,
  error,
  reveal = false,
  className,
  id,
  ...props
}: Props) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId} className="block">
        {label}
      </Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
        <Input
          id={fieldId}
          type={reveal ? (revealed ? "text" : "password") : props.type}
          className={cn(
            "h-11 pl-10",
            reveal && "pr-11",
            error && "border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-500/20",
            className,
          )}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {reveal ? (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
