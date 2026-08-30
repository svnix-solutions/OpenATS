"use client";

import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { BubbleChatIcon, Copy01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useConnectWhatsapp,
  useDisconnectChannel,
  useMessagingConnections,
  type ConnectWhatsappResult,
} from "@/hooks/queries/use-messaging-channels";

/**
 * Messaging channels, kept apart from the meeting integrations above.
 *
 * They are not the same kind of thing. A meeting provider is connected per
 * person over OAuth and creates a meeting; a channel belongs to the agency,
 * carries conversations on its behalf, and is connected by pasting credentials
 * from a provider's console. Sharing the card would mean one component with
 * two unrelated halves.
 */
export function MessagingChannels() {
  const { data, isLoading } = useMessagingConnections();
  const disconnect = useDisconnectChannel();
  const [justConnected, setJustConnected] = useState<ConnectWhatsappResult | null>(
    null,
  );

  const whatsapp = data?.data.find((c) => c.channel === "whatsapp");

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
        Candidate messaging
      </h2>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">
        Channels a candidate can be reached on. A conversation begins when they
        message you — neither WhatsApp nor Telegram lets you write to someone
        who has not opted in.
      </p>

      <div className="mt-4 max-w-2xl rounded-md border border-slate-300 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-400">
            <HugeiconsIcon icon={BubbleChatIcon} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-slate-900 dark:text-neutral-100">
              WhatsApp
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400 dark:text-neutral-500">
              Through Meta&apos;s Cloud API. Replies arrive on the candidate,
              and you can answer freely for 24 hours after each of their
              messages.
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : whatsapp ? (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-neutral-200">
                  {whatsapp.accountLabel ?? "Connected"}
                </p>
                {whatsapp.isActive ? (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    Active
                  </p>
                ) : (
                  // Not hidden. An inactive channel is why messages stopped,
                  // and the reason is the only thing that makes it fixable.
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Stopped: {whatsapp.lastError ?? "unknown reason"}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                disabled={disconnect.isPending}
                onClick={async () => {
                  await disconnect.mutateAsync("whatsapp");
                  toast.success("WhatsApp disconnected");
                }}
              >
                Disconnect
              </Button>
            </div>

            {whatsapp.webhookUrl ? (
              <CopyRow label="Webhook URL" value={whatsapp.webhookUrl} />
            ) : (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                The webhook URL cannot be shown because{" "}
                <code>PUBLIC_API_URL</code> is not set on the API. Without it
                this page would have to guess, and a wrong URL in Meta&apos;s
                console fails silently.
              </p>
            )}
          </div>
        ) : (
          <ConnectWhatsappForm onConnected={setJustConnected} />
        )}

        {justConnected && (
          <div className="mt-4 space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Copy both into Meta now — the verify token is not shown again.
            </p>
            {justConnected.webhookUrl && (
              <CopyRow label="Callback URL" value={justConnected.webhookUrl} />
            )}
            <CopyRow
              label="Verify token"
              value={justConnected.webhookVerifyToken}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function ConnectWhatsappForm({
  onConnected,
}: {
  onConnected: (result: ConnectWhatsappResult) => void;
}) {
  const connect = useConnectWhatsapp();
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");

  const ready = phoneNumberId.trim() && accessToken.trim() && appSecret.trim();

  return (
    <div className="mt-4 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="wa-phone">Phone number ID</Label>
        <Input
          id="wa-phone"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder="From Meta → WhatsApp → API Setup"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wa-token">Access token</Label>
        <Input
          id="wa-token"
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="A permanent system-user token"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wa-secret">App secret</Label>
        <Input
          id="wa-secret"
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          placeholder="Meta → App settings → Basic"
        />
        <p className="text-xs text-slate-400">
          Signs every incoming webhook. Without it anyone who finds the URL can
          post messages as your candidates.
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          disabled={!ready || connect.isPending}
          onClick={async () => {
            try {
              const { data } = await connect.mutateAsync({
                phoneNumberId: phoneNumberId.trim(),
                accessToken: accessToken.trim(),
                appSecret: appSecret.trim(),
              });
              onConnected(data);
              toast.success(`WhatsApp connected as ${data.accountLabel}`);
            } catch (err) {
              // The API checks the credentials with Meta before storing them,
              // so this message is Meta's own and worth showing verbatim.
              toast.error(
                err instanceof Error ? err.message : "Could not connect",
              );
            }
          }}
        >
          {connect.isPending ? "Checking with Meta…" : "Connect WhatsApp"}
        </Button>
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-700 dark:bg-neutral-800 dark:text-neutral-300">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          }}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          <HugeiconsIcon icon={Copy01Icon} className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
