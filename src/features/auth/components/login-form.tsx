"use client";

import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { loginAction } from "@/features/auth/actions";
import { AuthField } from "@/features/auth/components/auth-field";
import type { AuthActionState } from "@/features/auth/schemas";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const initialState: AuthActionState = {};

type LoginFormProps = {
  nextPath?: string;
};

export function LoginForm({ nextPath = "/dashboard" }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={nextPath} />

      {state.error ? <Alert variant="error">{state.error}</Alert> : null}

      <AuthField
        label="Email"
        icon={Mail}
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        error={state.fieldErrors?.email?.[0]}
      />

      <AuthField
        label="Password"
        icon={Lock}
        id="password"
        name="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        required
        minLength={8}
        reveal
        error={state.fieldErrors?.password?.[0]}
      />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in
          </>
        ) : (
          <>
            Sign in
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>

      <p className="text-center text-sm text-slate-500">
        New to Mhenbulk?{" "}
        <Link
          href="/signup"
          className="font-medium text-indigo-600 transition hover:text-indigo-500"
        >
          Create your workspace
        </Link>
      </p>
    </form>
  );
}
