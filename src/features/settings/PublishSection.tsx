import { useState } from "react";
import { LogOut, RotateCcw } from "lucide-react";
import { getServices } from "@/app/services";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { toGenerationError } from "@/domain/models";
import { useT } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { Section } from "./SettingsPrimitives";

/** Settings → Publishing: bring the automation warning back and erase the isolated Vinted session. */
export function PublishSection() {
  const t = useT();
  const acknowledged = useSettingsStore((s) => s.settings.vintedAutomationAcknowledged);
  const update = useSettingsStore((s) => s.update);
  const [busy, setBusy] = useState(false);
  const supported = getServices().publish.supported;

  const logout = async () => {
    setBusy(true);
    try {
      await getServices().publish.clearSession();
      toast.success(t("publish.settings.loggedOut"));
    } catch (err) {
      toast.error(errorMessage(toGenerationError(err), "vinted"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="publish" title={t("settings.section.publish")}>
      <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        <p className="text-fg-muted">{t("publish.settings.body")}</p>
        {!supported && <p className="text-xs text-fg-subtle">{t("publish.reason.desktopOnly")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            leftIcon={<RotateCcw className="size-3.5" />}
            disabled={!acknowledged}
            onClick={() => void update({ vintedAutomationAcknowledged: false })}
          >
            {t("publish.settings.showTerms")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            leftIcon={<LogOut className="size-3.5" />}
            disabled={!supported || busy}
            loading={busy}
            onClick={() => void logout()}
          >
            {t("publish.settings.logout")}
          </Button>
        </div>
      </div>
    </Section>
  );
}
