import { AlertTriangle } from "lucide-react";

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <AlertTriangle size={20} />
      <span>{message}</span>
      {onRetry ? <button className="link-button" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}
