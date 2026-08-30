import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serverFetch } from "@/lib/auth-action";

export type CandidateMessage = {
  id: number;
  channel: "whatsapp" | "telegram";
  direction: "inbound" | "outbound";
  body: string;
  sentBy: number | null;
  delivery: "queued" | "sent" | "delivered" | "read" | "failed";
  failureReason: string | null;
  sentAt: string;
};

export type CandidateChannel = {
  channel: "whatsapp" | "telegram";
  externalId: string;
  displayName: string | null;
  optedInAt: string | null;
  optedOutAt: string | null;
  /**
   * When free-form sending closes, or null if it is already shut. WhatsApp
   * carries plain text only inside the 24 hours the candidate's own last
   * message opens; the screen reads this rather than guessing.
   */
  freeFormOpenUntil: string | null;
};

/** `id` is an application id, as everywhere else the dashboard links to. */
export function useCandidateMessages(applicationId: number) {
  return useQuery({
    queryKey: ["candidate-messages", applicationId],
    queryFn: () =>
      serverFetch<{ data: { messages: CandidateMessage[]; channels: CandidateChannel[] } }>(
        `/candidates/${applicationId}/messages`,
      ),
    // A conversation is the one screen where being a minute stale is
    // obviously wrong to the person reading it.
    refetchInterval: 20_000,
  });
}

export function useSendCandidateMessage(applicationId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channel: "whatsapp" | "telegram"; body: string }) =>
      serverFetch<{ data: CandidateMessage }>(
        `/candidates/${applicationId}/messages`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["candidate-messages", applicationId],
      }),
  });
}
