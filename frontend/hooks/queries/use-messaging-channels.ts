import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serverFetch } from "@/lib/auth-action";

export type MessagingConnection = {
  channel: "whatsapp" | "telegram";
  accountLabel: string | null;
  isActive: boolean;
  /** Why it stopped working. The screen has to explain this, not hide it. */
  lastError: string | null;
  connectedAt: string;
  /** Null when PUBLIC_API_URL is not configured, rather than a guessed URL. */
  webhookUrl: string | null;
};

const KEY = ["messaging-connections"];

export function useMessagingConnections() {
  return useQuery({
    queryKey: KEY,
    queryFn: () =>
      serverFetch<{ data: MessagingConnection[] }>("/messaging/connections"),
  });
}

export type ConnectWhatsappInput = {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
};

export type ConnectWhatsappResult = {
  accountLabel: string;
  webhookUrl: string | null;
  /**
   * Shown once and never again. It is not stored anywhere readable, and
   * reconnecting issues a new one — so the screen has to make clear that this
   * is the moment to copy it.
   */
  webhookVerifyToken: string;
};

export function useConnectWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectWhatsappInput) =>
      serverFetch<{ data: ConnectWhatsappResult }>(
        "/messaging/connections/whatsapp",
        { method: "POST", body: JSON.stringify({ channel: "whatsapp", ...input }) },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDisconnectChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channel: "whatsapp" | "telegram") =>
      serverFetch<unknown>(`/messaging/connections/${channel}`, {
        method: "DELETE",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
