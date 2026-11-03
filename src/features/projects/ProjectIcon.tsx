import type { ReactNode } from "react";
import { Globe, Megaphone, Receipt, ShoppingCart, Smartphone } from "lucide-react";
import type { ProjectIcon as ProjectIconKey } from "../../lib/demo/data";

const ICONS: Record<ProjectIconKey, ReactNode> = {
  globe: <Globe size={18} />,
  cart: <ShoppingCart size={18} />,
  phone: <Smartphone size={18} />,
  megaphone: <Megaphone size={18} />,
  receipt: <Receipt size={18} />
};

export function ProjectIcon({ icon }: { icon: ProjectIconKey }) {
  return (
    <span className="project-icon" aria-hidden="true">
      {ICONS[icon]}
    </span>
  );
}
