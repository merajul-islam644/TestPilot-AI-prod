import { Languages } from "lucide-react";
import { useT } from "../../lib/i18n/LocalizationProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../../shared/ui/dropdown-menu";

// Hidden until the tenant actually has more than one language configured --
// a switcher with a single option is dead chrome.
export function LanguageSwitcher() {
  const { language, languages, setLanguage } = useT();
  if (languages.length < 2) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="icon-button" aria-label="Change language">
        <Languages size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {languages.map((entry) => (
          <DropdownMenuItem key={entry.code} onSelect={() => setLanguage(entry.code)}>
            {entry.name}{entry.code === language ? " \u2713" : ""}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
