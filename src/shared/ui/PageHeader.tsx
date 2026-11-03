import type { ReactNode } from "react";

export function PageHeader({ actions, subtitle, title }: { actions?: ReactNode; subtitle: string; title: string }) {
  return <header className="page-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</header>;
}
