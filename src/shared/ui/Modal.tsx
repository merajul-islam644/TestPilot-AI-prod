import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

// A generic overlay used by every create/edit/delete dialog in the app --
// backdrop click and Escape both close it, matching what a native <dialog>
// gives you for free.
export function Modal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div aria-modal="true" className="modal" role="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
