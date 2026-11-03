import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LocalizationProvider } from "../../lib/i18n/LocalizationProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Without this, every component that mounts a query (e.g. the
      // always-visible UserMenu and the Profile page both querying
      // ["iam", "me"]) treats cached data as stale immediately and
      // refetches on mount, even seconds after another mount just loaded it.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: false
    }
  }
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LocalizationProvider>{children}</LocalizationProvider>
    </QueryClientProvider>
  );
}
