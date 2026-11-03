import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; variant?: "primary" | "icon" };

export function ActionButton({ children, icon, variant = "primary", ...props }: Props) {
  return <button className={variant === "icon" ? "icon-button" : "primary-button"} {...props}>{icon}{children}</button>;
}
