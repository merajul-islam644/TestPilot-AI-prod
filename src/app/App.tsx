import { Toaster } from "sonner";
import { AppProviders } from "./providers/AppProviders";
import { AuthProvider } from "./providers/AuthProvider";
import { ThemeProvider, useTheme } from "./providers/ThemeProvider";
import { AppRouter } from "./router/routes";

// Toasts follow the app's resolved theme -- sonner's own "system" would
// ignore an explicit in-app light/dark override.
function AppToaster() {
  const { resolved } = useTheme();
  return <Toaster closeButton position="bottom-right" richColors theme={resolved} />;
}

export function App() {
  return (
    <AppProviders>
      <ThemeProvider>
        <AuthProvider>
          <AppRouter />
          <AppToaster />
        </AuthProvider>
      </ThemeProvider>
    </AppProviders>
  );
}
