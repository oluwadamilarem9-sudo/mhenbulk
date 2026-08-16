import { LoginForm } from "@/features/auth/components/login-form";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath =
    params.next && params.next.startsWith("/") ? params.next : "/dashboard";

  return (
    <div>
      <div className="rounded-2xl border border-slate-200/80 bg-white p-8 shadow-[0_28px_60px_-28px_rgba(15,23,42,0.35)]">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Sign in to pick up your campaigns where you left off.
        </p>
        <div className="mt-7">
          <LoginForm nextPath={nextPath} />
        </div>
      </div>
      <p className="mt-6 text-center text-xs leading-5 text-slate-500">
        Mhenbulk sends from your own connected inbox. You stay responsible for
        who you contact.
      </p>
    </div>
  );
}
