import { useState } from "react";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { getServices } from "@/app/services";
import { useT } from "@/i18n";

/**
 * Warns that Vinted's terms forbid automated tools before the first pre-fill. "Don't show again"
 * persists the acknowledgement; without it the user still continues, for this run only.
 */
export function TermsDialog({ open, onClose, onContinue }: { open: boolean; onClose: () => void; onContinue: () => void }) {
  const t = useT();
  const update = useSettingsStore((s) => s.update);
  const [dontShow, setDontShow] = useState(false);

  const close = () => {
    setDontShow(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("publish.terms.title")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (dontShow) void update({ vintedAutomationAcknowledged: true });
              setDontShow(false);
              onContinue();
            }}
          >
            {t("publish.terms.continue")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">{t("publish.terms.body")}</p>
      {getServices().publish.mode === "delegated" && (
        // Google blocks OAuth inside embedded WebViews (Android WebView, WKWebView); the desktop window is not affected.
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm text-fg">{t("publish.terms.noGoogle")}</p>
      )}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="size-4 accent-accent" />
        {t("publish.terms.dontShow")}
      </label>
    </Dialog>
  );
}
