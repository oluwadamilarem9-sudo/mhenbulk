import { SignupForm } from "@/features/auth/components/signup-form";

export default function SignupPage() {
  return (
    <div>
      <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-[0_28px_60px_-28px_rgba(15,23,42,0.35)]">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Create your workspace
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Connect an inbox, build your first batch, and send in minutes.
        </p>
        <div className="mt-7">
          <SignupForm />
        </div>
      </div>
      <p className="mt-6 text-center text-xs leading-5 text-slate-500">
        No card required. Bring your own Gmail account and start with your own
        contacts.
      </p>
    </div>
  );
}
