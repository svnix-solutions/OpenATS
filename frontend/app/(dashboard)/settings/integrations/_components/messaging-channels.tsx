"use client";

import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { BubbleChatIcon, Copy01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IntegrationCardShell,
  integrationConnectButtonClassName,
} from "./integration-card";
import { TelegramConnect } from "./telegram-connect";
import {
  useConnectWhatsapp,
  useDisconnectChannel,
  useMessagingConnections,
  type ConnectWhatsappResult,
  type MessagingConnection,
} from "@/hooks/queries/use-messaging-channels";

/**
 * Messaging channels, as cards in the same grid as the meeting integrations.
 *
 * They were a pair of panels with their credential forms permanently open,
 * which is not how anything else on this page behaves: a card says what the
 * integration is and offers Connect, and the form is what Connect leads to.
 * Two shapes for one idea on one screen is worse than either shape.
 *
 * Still a separate section rather than folded into that grid. A meeting
 * provider is connected per person over OAuth and creates a meeting; a channel
 * belongs to the agency and carries conversations for it. The heading is what
 * says so.
 */
export function MessagingChannels() {
  const { data, isLoading } = useMessagingConnections();
  const [connecting, setConnecting] = useState<"whatsapp" | "telegram" | null>(
    null,
  );
  const [justConnected, setJustConnected] =
    useState<ConnectWhatsappResult | null>(null);

  const whatsapp = data?.data.find((c) => c.channel === "whatsapp");
  const telegram = data?.data.find((c) => c.channel === "telegram");

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
        Candidate messaging
      </h2>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">
        Channels a candidate can be reached on. A conversation begins when they
        opt in — neither WhatsApp nor Telegram lets you write to someone who has
        not.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ChannelCard
          name="WhatsApp"
          description="Through Meta's Cloud API. You can answer freely for 24 hours after each of their messages, and reach them with an approved template outside that."
          connection={whatsapp}
          isLoading={isLoading}
          onConnect={() => setConnecting("whatsapp")}
        />
        <ChannelCard
          name="Telegram"
          description="Signs in a Telegram account of yours. No 24-hour window — but Telegram limits accounts that message people who have not written first."
          connection={telegram}
          isLoading={isLoading}
          onConnect={() => setConnecting("telegram")}
        />
      </div>

      <Dialog
        open={connecting !== null}
        onOpenChange={(o) => !o && setConnecting(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Connect {connecting === "telegram" ? "Telegram" : "WhatsApp"}
            </DialogTitle>
          </DialogHeader>

          {connecting === "whatsapp" && (
            <ConnectWhatsappForm
              onConnected={(result) => {
                setConnecting(null);
                setJustConnected(result);
              }}
            />
          )}
          {connecting === "telegram" && (
            <TelegramConnect onConnected={() => setConnecting(null)} />
          )}
        </DialogContent>
      </Dialog>

      {/*
        Outside the dialog on purpose. The verify token is shown once and is
        not readable again, so it must not disappear with the thing that
        produced it.
      */}
      <Dialog
        open={justConnected !== null}
        onOpenChange={(o) => !o && setJustConnected(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Finish in Meta</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Copy both into Meta now — the verify token is not shown again.
          </p>
          {justConnected?.webhookUrl && (
            <CopyRow label="Callback URL" value={justConnected.webhookUrl} />
          )}
          {justConnected && (
            <CopyRow
              label="Verify token"
              value={justConnected.webhookVerifyToken}
            />
          )}
          <div className="flex justify-end">
            <Button onClick={() => setJustConnected(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ChannelCard({
  name,
  description,
  connection,
  isLoading,
  onConnect,
}: {
  name: string;
  description: string;
  connection: MessagingConnection | undefined;
  isLoading: boolean;
  onConnect: () => void;
}) {
  const disconnect = useDisconnectChannel();

  return (
    <IntegrationCardShell
      name={name}
      icon={<HugeiconsIcon icon={BubbleChatIcon} className="size-5 text-slate-500" />}
      description={description}
    >
      {isLoading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : connection ? (
        <div className="space-y-2">
          <p className="truncate text-xs text-slate-500 dark:text-neutral-400">
            {connection.isActive ? (
              <>
                Connected as{" "}
                <span className="font-medium text-slate-700 dark:text-neutral-200">
                  {connection.accountLabel ?? name}
                </span>
              </>
            ) : (
              // Not hidden: this is why messages stopped, and the only thing
              // that makes it fixable.
              <span className="text-red-600 dark:text-red-400">
                Stopped: {connection.lastError ?? "unknown reason"}
              </span>
            )}
          </p>
          {connection.webhookUrl && (
            <CopyRow label="Webhook URL" value={connection.webhookUrl} />
          )}
          <button
            onClick={async () => {
              await disconnect.mutateAsync(connection.channel);
              toast.success(`${name} disconnected`);
            }}
            disabled={disconnect.isPending}
            className="inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-md border border-slate-200 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <button
          onClick={onConnect}
          className={integrationConnectButtonClassName}
          style={{ backgroundColor: "var(--theme-color)" }}
        >
          Connect
        </button>
      )}
    </IntegrationCardShell>
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
  const [businessAccountId, setBusinessAccountId] = useState("");

  const ready = phoneNumberId.trim() && accessToken.trim() && appSecret.trim();

  return (
    <div className="space-y-3">
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
        <Label htmlFor="wa-waba">Business account ID (optional)</Label>
        <Input
          id="wa-waba"
          value={businessAccountId}
          onChange={(e) => setBusinessAccountId(e.target.value)}
          placeholder="Meta → WhatsApp → API Setup"
        />
        <p className="text-xs text-slate-400">
          Only needed to offer approved templates, which are the one way to
          reach a candidate who has not replied in 24 hours.
        </p>
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
                ...(businessAccountId.trim() && {
                  businessAccountId: businessAccountId.trim(),
                }),
              });
              toast.success(`WhatsApp connected as ${data.accountLabel}`);
              onConnected(data);
            } catch (err) {
              // Checked with Meta before anything is stored, so this message is
              // Meta's own and worth showing verbatim.
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
