"use client";

import { useState } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";

// Opt-in, and not hardcoded. This panel used to render real credentials on
// every deployment's login page, demo or not. Set both variables to show it;
// leave either unset and it does not render.
const DEMO_USERNAME = process.env.NEXT_PUBLIC_DEMO_USERNAME;
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD;
const SHOW_DEMO_CREDENTIALS = Boolean(DEMO_USERNAME && DEMO_PASSWORD);

function CredentialRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-[14px] font-medium text-slate-600">{label}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-slate-900 cursor-pointer hover:text-theme transition-colors"
      >
        {value}
        <HugeiconsIcon
          icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
          className={`size-4.5 ${copied ? "text-theme" : "text-slate-600"}`}
          strokeWidth={2}
        />
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6 md:p-8 bg-white">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <style jsx>{`
          :global(.custom-signin h2) {
            font-size: 0;
          }
          :global(.custom-signin h2::after) {
            content: "Sign in to OpenATS";
            font-size: 1.375rem;
          }
        `}</style>
        <SignInForm />
      </div>

      {SHOW_DEMO_CREDENTIALS ? (
        <div className="fixed top-6 right-6 w-96 rounded-xl border border-theme/30 bg-theme/5 p-6">
          <p className="text-[15px] font-semibold tracking-wider text-theme mb-3">
            Demo credentials
          </p>
          <div className="flex flex-col gap-2">
            <CredentialRow label="Username" value={DEMO_USERNAME!} />
            <CredentialRow label="Password" value={DEMO_PASSWORD!} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
