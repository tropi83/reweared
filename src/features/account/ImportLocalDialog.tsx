import { useEffect, useState } from "react";
import { toGenerationError } from "@aiv/domain/models";
import { LocalImport } from "@/app/import-local";
import { getServices } from "@/app/services";
import { useListingsStore } from "@/app/stores/listings-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useT } from "@/i18n";
import { errorMessage } from "@/i18n/errors";

const OFFERED_KEY = "import_offered";

function localImport() {
  const { storage, listings } = getServices();
  return new LocalImport(storage, listings);
}

/** How many of this device's listings are not in the account yet; null while unknown. */
export function usePendingLocalListings(): [number | null, () => void] {
  const [count, setCount] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void localImport()
      .pending()
      .then((list) => !cancelled && setCount(list.length))
      .catch(() => !cancelled && setCount(0));
    return () => {
      cancelled = true;
    };
  }, [version]);
  return [count, () => setVersion((v) => v + 1)];
}

/** API mode, after sign-in: offers the import once when this device still has listings of the local app. */
export function ImportLocalOffer() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([localImport().pending(), getServices().storage.readMeta<boolean>(OFFERED_KEY)])
      .then(([list, offered]) => {
        if (!cancelled && list.length > 0 && !offered) setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const close = () => {
    setOpen(false);
    void getServices().storage.writeMeta(OFFERED_KEY, true);
  };
  return <ImportLocalDialog open={open} onClose={close} />;
}

export function ImportLocalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [pending, refresh] = usePendingLocalListings();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const importer = localImport();
    const list = await importer.pending();
    setError(null);
    setProgress({ done: 0, total: list.length });
    let imported = 0;
    try {
      for (const [i, listing] of list.entries()) {
        if (await importer.importOne(listing.id)) imported++;
        setProgress({ done: i + 1, total: list.length });
      }
      toast.success(t("import.local.done", { count: imported }));
      onClose();
    } catch (err) {
      // What was imported stays imported; "Try again" resumes with the rest.
      setError(errorMessage(toGenerationError(err)));
    } finally {
      setProgress(null);
      refresh();
      void useListingsStore.getState().loadSummaries();
    }
  };

  const busy = progress !== null;
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t("import.local.title")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("import.local.later")}
          </Button>
          <Button onClick={() => void run()} loading={busy} disabled={!pending}>
            {error ? t("import.local.retry") : t("import.local.start", { count: pending ?? 0 })}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>{t("import.local.body", { count: pending ?? 0 })}</p>
        <p className="text-fg-muted">{t("import.local.what")}</p>
        {progress && (
          <p role="status" aria-live="polite">
            {t("import.local.progress", { done: progress.done, total: progress.total })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
