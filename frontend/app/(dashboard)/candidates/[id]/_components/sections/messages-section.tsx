"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useCandidateMessages,
  useFindOnTelegram,
  useSendCandidateMessage,
  type CandidateChannel,
} from "@/hooks/queries/use-candidate-messages";
import { timeAgo } from "../constants";

/**
 * The conversation with this candidate.
 *
 * The screen's real job is explaining when a message cannot be sent. WhatsApp
 * carries plain text only inside the 24 hours the candidate's own last message
 * opens; outside it, nothing a recruiter types will arrive. Discovering that
 * by pressing send and reading an error is worse than being told up front, so
 * the composer disables itself and says why.
 */
export function MessagesSection({ applicationId }: { applicationId: number }) {
  const { data, isLoading } = useCandidateMessages(applicationId);
  const send = useSendCandidateMessage(applicationId);
  const find = useFindOnTelegram(applicationId);
  const [body, setBody] = useState("");

  const messages = data?.data.messages ?? [];
  const channels = data?.data.channels ?? [];
  const channel = channels[0];

  const open = channel ? isOpen(channel) : false;

  async function submit() {
    if (!channel || !body.trim()) return;
    try {
      await send.mutateAsync({ channel: channel.channel, body: body.trim() });
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send");
    }
  }

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading the conversation…</p>;
  }

  if (!channel) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 px-4 py-10 text-center dark:border-neutral-700">
        <p className="text-sm font-semibold text-slate-500">
          No messaging channel for this candidate
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
          They opt in on the application form. WhatsApp needs them to have
          agreed; Telegram can be looked up from the number they gave.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>
          {channel.channel === "whatsapp" ? "WhatsApp" : "Telegram"} ·{" "}
          {channel.displayName ?? channel.externalId}
        </span>
        <ChannelState channel={channel} />
      </div>

      {/*
        Offered only when there is no Telegram thread yet, and only ever for
        one candidate at a time. Looking numbers up in bulk is what Telegram
        limits accounts for, and it is the agency's own account that stops
        working.
      */}
      {!channels.some((c) => c.channel === "telegram") && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-neutral-800">
          <p className="text-xs text-slate-500">
            Telegram has no 24-hour window. Look this candidate up by the number
            they gave?
          </p>
          <Button
            variant="ghost"
            disabled={find.isPending}
            onClick={async () => {
              try {
                await find.mutateAsync();
                toast.success(
                  "Asked Telegram. If they have an account it appears here shortly.",
                );
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Could not ask Telegram",
                );
              }
            }}
          >
            {find.isPending ? "Asking…" : "Find on Telegram"}
          </Button>
        </div>
      )}

      <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3 dark:border-neutral-800">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            Nothing yet.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                  m.direction === "outbound"
                    ? "bg-[var(--theme-color)] text-white"
                    : "bg-slate-100 text-slate-800 dark:bg-neutral-800 dark:text-neutral-200"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p
                  className={`mt-1 text-[10px] ${
                    m.direction === "outbound"
                      ? "text-white/70"
                      : "text-slate-400"
                  }`}
                >
                  {timeAgo(m.sentAt)}
                  {m.delivery === "failed" && " · failed"}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={!open || send.isPending}
          rows={3}
          placeholder={
            open ? "Write a reply…" : "Replies are closed — see above"
          }
          aria-label="Message to the candidate"
          className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-900/60"
        />
        <div className="flex justify-end">
          <Button
            onClick={submit}
            disabled={!open || !body.trim() || send.isPending}
          >
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function isOpen(channel: CandidateChannel): boolean {
  if (channel.optedOutAt) return false;
  // Telegram has no window. The 24-hour rule is WhatsApp's, and treating both
  // the same would leave a Telegram composer permanently disabled for a
  // candidate who simply had not written first.
  if (channel.channel === "telegram") return true;
  if (!channel.freeFormOpenUntil) return false;
  return new Date(channel.freeFormOpenUntil) > new Date();
}

/**
 * Why the composer is or is not usable.
 *
 * Three different reasons, and they are not interchangeable: opted out is
 * permanent and the recruiter should stop; a closed window reopens the moment
 * the candidate writes again; open is open.
 */
function ChannelState({ channel }: { channel: CandidateChannel }) {
  if (channel.optedOutAt) {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600 dark:bg-red-950/30 dark:text-red-400">
        Opted out
      </span>
    );
  }

  if (channel.channel === "telegram") {
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700 dark:bg-green-950/30 dark:text-green-400">
        Open
      </span>
    );
  }

  if (!channel.freeFormOpenUntil) {
    return (
      <span
        className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        title="WhatsApp only carries a plain message within 24 hours of the candidate's own last one. It reopens as soon as they write again."
      >
        Closed — waiting on the candidate
      </span>
    );
  }

  return (
    <span className="rounded-full bg-green-50 px-2 py-0.5 font-semibold text-green-700 dark:bg-green-950/30 dark:text-green-400">
      Open until {new Date(channel.freeFormOpenUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}
