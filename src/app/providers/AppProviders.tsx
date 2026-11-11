import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { translate, LocalizationProvider } from "../../lib/i18n/LocalizationProvider";

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
  },
  queryCache: new QueryCache({
    // A failed query used to fail silently (the UI just showed its fallback
    // state). Surface one calm toast; the fixed id stacks failures into a
    // single toast instead of one per component. Mutations keep their own
    // per-action toasts and never reach this handler.
    onError: (error, query) => {
      console.error("[TestPilot] Query failed:", error);
      // Queries flagged meta.silent own their failure UI — e.g. the avatar
      // read, whose initials fallback IS the graceful failure (a 403 from a
      // role that can't read the storage file in another org must not toast
      // on every org switch). Only unflagged failures surface here.
      if (query.meta?.silent === true) return;
      toast.error(translate("toast.queryFailed"), { id: "query-failed" });
    }
  })
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LocalizationProvider>{children}</LocalizationProvider>
    </QueryClientProvider>
  );
}
