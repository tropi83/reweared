import { Coins } from "lucide-react";
import { navigate } from "@/app/router";
import { useCredits } from "@/app/query/credits";
import { useT } from "@/i18n";

/** API mode: the balance under the app's name; opens Settings → Credits. */
export function CreditsBadge() {
  const t = useT();
  const { credits } = useCredits();
  return (
    <button
      type="button"
      onClick={() => navigate({ name: "settings", section: "credits" })}
      className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
      aria-label={credits ? t("credits.balance", { count: credits.balance }) : t("credits.title")}
    >
      <Coins className="size-3" aria-hidden />
      {credits ? t("credits.balance", { count: credits.balance }) : "…"}
    </button>
  );
}
