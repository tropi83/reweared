import { useId, useState } from "react";
import { Send } from "lucide-react";
import { useProjectsStore } from "@/app/stores/projects-store";
import { postEligibility, usePublishStore } from "@/app/stores/publish-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { orderedPhotoIds } from "@/domain/services/publish";
import { useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { TermsDialog } from "./TermsDialog";

/** Bottom bar of the workspace column: the entry point of the Vinted publishing flow. */
export function PostButton() {
  const t = useT();
  const reasonsId = useId();
  const doc = useProjectsStore((s) => s.current);
  const acknowledged = useSettingsStore((s) => s.settings.vintedAutomationAcknowledged);
  const start = usePublishStore((s) => s.start);
  // Why the last session of this project ended (window closed, open failure); cleared by the next start.
  const lastError = usePublishStore((s) => (s.session.stage === "closed" && s.session.projectId === doc?.project.id ? s.session.error : undefined));
  const [terms, setTerms] = useState(false);
  const { ok, reasons } = postEligibility(doc);
  const count = doc ? orderedPhotoIds(doc).length : 0;

  return (
    <div className="sticky bottom-0 -mx-4 mt-auto -mb-4 border-t border-border bg-bg/95 p-3 backdrop-blur">
      <Button
        variant="primary"
        className="w-full"
        disabled={!ok}
        aria-describedby={ok ? undefined : reasonsId}
        leftIcon={<Send className="size-4" />}
        onClick={() => (acknowledged ? void start() : setTerms(true))}
      >
        {count > 0 ? t("publish.button", { count }) : t("publish.button.none")}
      </Button>
      {!ok && (
        <ul id={reasonsId} className="mt-1.5 space-y-0.5 text-xs text-fg-subtle">
          {reasons.map((r) => (
            <li key={r}>{t(`publish.reason.${r}` as MessageKey)}</li>
          ))}
        </ul>
      )}
      {ok && lastError && (
        <p className="mt-1.5 text-xs text-fg-subtle" role="status">
          {lastError.code === "CANCELLED" ? t("publish.closed") : errorMessage(lastError, "vinted")}
        </p>
      )}
      <TermsDialog
        open={terms}
        onClose={() => setTerms(false)}
        onContinue={() => {
          setTerms(false);
          void start({ acknowledgedOnce: true });
        }}
      />
    </div>
  );
}
