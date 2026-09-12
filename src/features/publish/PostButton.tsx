import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { useListingsStore } from "@/app/stores/listings-store";
import { postEligibility, usePublishStore } from "@/app/stores/publish-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { orderedPhotoIds } from "@/domain/services/publish";
import { useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { cn } from "@/lib/cn";
import { TermsDialog } from "./TermsDialog";

/**
 * Header entry point of the Vinted publishing flow. Compact (icon + count) on narrow screens, labelled from `sm`.
 * When the listing is not postable the button stays tappable and explains why in a toast — a `disabled` button
 * would be mute on a phone.
 */
export function PostButton() {
  const t = useT();
  const doc = useListingsStore((s) => s.current);
  const acknowledged = useSettingsStore((s) => s.settings.vintedAutomationAcknowledged);
  const start = usePublishStore((s) => s.start);
  // Why the last session of this listing ended (window closed, open failure); cleared by the next start.
  const lastError = usePublishStore((s) => (s.session.stage === "closed" && s.session.listingId === doc?.listing.id ? s.session.error : undefined));
  const [terms, setTerms] = useState(false);
  const { ok, reasons } = postEligibility(doc);
  const count = doc ? orderedPhotoIds(doc).length : 0;
  const label = count > 0 ? t("publish.button", { count }) : t("publish.button.none");

  useEffect(() => {
    if (!lastError) return;
    const message = lastError.code === "CANCELLED" ? t("publish.closed") : errorMessage(lastError, "vinted");
    if (lastError.code === "CANCELLED") toast.info(message);
    else toast.error(message);
  }, [lastError, t]);

  const onClick = () => {
    if (!ok) return toast.info(reasons.map((r) => t(`publish.reason.${r}` as MessageKey)).join(" "));
    if (acknowledged) void start();
    else setTerms(true);
  };

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        aria-label={label}
        aria-disabled={ok ? undefined : true}
        className={cn("px-2.5 sm:px-3", !ok && "opacity-60")}
        leftIcon={<Send className="size-4" />}
        onClick={onClick}
      >
        <span className="hidden sm:inline">{label}</span>
        {count > 0 && (
          <span data-count className="rounded-full bg-accent-fg/20 px-1.5 text-[11px] leading-4 font-semibold tabular-nums sm:hidden">
            {count}
          </span>
        )}
      </Button>
      <TermsDialog
        open={terms}
        onClose={() => setTerms(false)}
        onContinue={() => {
          setTerms(false);
          void start({ acknowledgedOnce: true });
        }}
      />
    </>
  );
}
