import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useListingsStore } from "@/app/stores/listings-store";
import { toast } from "@/app/stores/toast-store";
import { getServices } from "@/app/services";
import { navigate } from "@/app/router";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import type { StorageUsage } from "@/infrastructure/storage";
import { useT } from "@/i18n";
import { Field, Section } from "./SettingsPrimitives";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function StorageSection() {
  const t = useT();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const summaries = useListingsStore((s) => s.summaries);
  const platform = getPlatform();

  useEffect(() => {
    void getServices().storage.getUsage().then(setUsage);
  }, [summaries]);

  const cleanup = async () => {
    setBusy(true);
    try {
      let removed = 0;
      for (const p of summaries) removed += await getServices().storage.cleanupOrphans(p.id);
      toast.success(t("storage.cleanupDone", { count: removed }));
      setUsage(await getServices().storage.getUsage());
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      const { storage, auth, queue } = getServices();
      queue.cancelAll();
      await storage.clearAll();
      await auth.apiKey.revoke();
      await auth.oauth.revoke().catch(() => undefined);
      auth.setActiveKind("none");
      useListingsStore.setState({ current: null, summaries: [] });
      navigate({ name: "home" });
      location.reload();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <Section id="storage" title={t("settings.section.storage")}>
      <div className="space-y-4 rounded-xl border border-border bg-bg-elevated p-4">
        <Field label={t("storage.location")}>
          <code className="block rounded-md bg-bg-sunken px-2 py-1 text-xs break-all">
            {platform.isTauri ? (usage?.location ?? "…") : t("storage.locationWeb")}
          </code>
        </Field>
        <Field label={t("settings.section.storage")}>
          <span className="text-sm">{usage ? t("storage.usage", { count: usage.listingCount, size: formatBytes(usage.imageBytes) }) : "…"}</span>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void cleanup()} loading={busy}>
            {t("storage.cleanup")}
          </Button>
          <Button variant="danger" leftIcon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)}>
            {t("storage.clearAll")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={clearAll}
        title={t("storage.clearAll")}
        body={t("storage.clearAll.body")}
        confirmLabel={t("common.delete")}
        danger
        busy={busy}
      />
    </Section>
  );
}
