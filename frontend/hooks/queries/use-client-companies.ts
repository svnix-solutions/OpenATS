import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { serverFetch } from "@/lib/auth-action";
import type { ClientCompany } from "@/types";

const KEY = ["client-companies"];

export function useClientCompanies() {
  return useQuery({
    queryKey: KEY,
    queryFn: () =>
      serverFetch<{ data: ClientCompany[] }>("/client-companies"),
    staleTime: 1000 * 60 * 5,
  });
}

export type ClientCompanyInput = {
  name: string;
  slug: string;
  website?: string | null;
  description?: string | null;
  logoUrl?: string | null;
};

export function useCreateClientCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ClientCompanyInput) =>
      serverFetch<{ data: ClientCompany }>("/client-companies", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateClientCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: ClientCompanyInput & { id: number }) =>
      serverFetch<{ data: ClientCompany }>(`/client-companies/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteClientCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      serverFetch<unknown>(`/client-companies/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

/** "Acme Corp Ltd." → "acme-corp-ltd", matching what the API accepts. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}
