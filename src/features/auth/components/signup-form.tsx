"use client";

import { ArrowRight, Loader2, Lock, Mail, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { signupAction } from "@/features/auth/actions";
import { AuthField } from "@/features/auth/components/auth-field";
import type { AuthActionState } from "@/features/auth/schemas";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const initialState: AuthActionState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert variant="error">{state.error}</Alert> : null}
      {state.success ? <Alert variant="success">{state.success}</Alert> : null}

      <AuthField
        label="Full name"
        icon={User}
        id="fullName"
        name="fullName"
        autoComplete="name"
        placeholder="Alex Morgan"
        required
        error={state.fieldErrors?.fullName?.[0]}
      />

      <AuthField
        label="Work email"
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
        autoComplete="new-password"
        placeholder="At least 8 characters"
        required
        minLength={8}
        reveal
        error={state.fieldErrors?.password?.[0]}
      />

      <AuthField
        label="Confirm password"
        icon={ShieldCheck}
        id="confirmPassword"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="Repeat your password"
        required
        minLength={8}
        reveal
        error={state.fieldErrors?.confirmPassword?.[0]}
      />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating your workspace
          </>
        ) : (
          <>
            Create account
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-indigo-600 transition hover:text-indigo-500"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
