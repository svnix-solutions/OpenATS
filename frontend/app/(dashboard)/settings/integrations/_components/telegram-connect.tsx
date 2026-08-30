"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useStartTelegramLogin,
  useVerifyTelegramLogin,
} from "@/hooks/queries/use-messaging-channels";

/**
 * Signing the agency's Telegram account in.
 *
 * Three steps rather than one form, because MTProto is three steps: the code
 * cannot be asked for until Telegram has sent it, and the password cannot be
 * asked for until Telegram says the account has one — it only reveals that
 * after accepting the code.
 *
 * The state lives on the server between them: a half-authenticated connection
 * that the code must travel over. So this is not a wizard that could be one
 * page with everything filled in first.
 */
type Step = "credentials" | "code" | "password";

export function TelegramConnect() {
  const start = useStartTelegramLogin();
  const verify = useVerifyTelegramLogin();

  const [step, setStep] = useState<Step>("credentials");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  async function sendCode() {
    try {
      await start.mutateAsync({
        apiId: Number(apiId),
        apiHash: apiHash.trim(),
        phoneNumber: phoneNumber.trim(),
      });
      setStep("code");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start");
    }
  }

  async function submitCode(withPassword?: string) {
    try {
      const { data } = await verify.mutateAsync(
        withPassword ? { code: code.trim(), password: withPassword } : { code: code.trim() },
      );
      if (data.status === "needs_password") {
        setStep("password");
        return;
      }
      toast.success(`Telegram connected as ${data.accountLabel}`);
      setStep("credentials");
      setApiId(""); setApiHash(""); setPhoneNumber(""); setCode(""); setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign in");
    }
  }

  if (step === "code") {
    return (
      <Panel
        title="Enter the login code"
        hint="Telegram sends it inside the app on that account, not by SMS — unless the account is not signed in anywhere, in which case it does arrive as a text."
      >
        <Field id="tg-code" label="Login code" value={code} onChange={setCode} />
        <Actions
          onBack={() => setStep("credentials")}
          onSubmit={() => submitCode()}
          busy={verify.isPending}
          submitLabel="Sign in"
          canSubmit={code.trim().length >= 3}
        />
      </Panel>
    );
  }

  if (step === "password") {
    return (
      <Panel
        title="Two-step verification"
        hint="This account has a password set. Telegram only says so after the code is accepted, which is why it was not asked for earlier."
      >
        <Field
          id="tg-password"
          label="Telegram password"
          type="password"
          value={password}
          onChange={setPassword}
        />
        <Actions
          onBack={() => setStep("code")}
          onSubmit={() => submitCode(password)}
          busy={verify.isPending}
          submitLabel="Sign in"
          canSubmit={password.length > 0}
        />
      </Panel>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="tg-api-id" label="api_id" value={apiId} onChange={setApiId} placeholder="From my.telegram.org" />
        <Field id="tg-api-hash" label="api_hash" value={apiHash} onChange={setApiHash} type="password" placeholder="From my.telegram.org" />
      </div>
      <Field
        id="tg-phone"
        label="Phone number"
        value={phoneNumber}
        onChange={setPhoneNumber}
        placeholder="+49301234567"
      />
      <p className="text-xs text-slate-400">
        Use a number dedicated to recruiting, not a personal account. Telegram
        limits accounts that message people who have not written first, and it
        is this account that stops working.
      </p>
      <div className="flex justify-end">
        <Button
          disabled={
            !apiId.trim() || !apiHash.trim() || !phoneNumber.trim() || start.isPending
          }
          onClick={sendCode}
        >
          {start.isPending ? "Asking Telegram…" : "Send login code"}
        </Button>
      </div>
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 space-y-3 rounded-md border border-slate-200 p-4 dark:border-neutral-800">
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-neutral-200">
          {title}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Actions({
  onBack,
  onSubmit,
  busy,
  submitLabel,
  canSubmit,
}: {
  onBack: () => void;
  onSubmit: () => void;
  busy: boolean;
  submitLabel: string;
  canSubmit: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onBack} disabled={busy}>
        Back
      </Button>
      <Button onClick={onSubmit} disabled={busy || !canSubmit}>
        {busy ? "Checking…" : submitLabel}
      </Button>
    </div>
  );
}
