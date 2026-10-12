import { useState } from "react";
import { useAccountStore } from "@/app/stores/account-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useT } from "@/i18n";
import { Section } from "@/features/settings/SettingsPrimitives";
import { accountErrorMessage } from "./account-errors";

/** Settings → Account (API mode): who is signed in, sign out, delete the account by email link. */
export function AccountSection() {
  const t = useT();
  const me = useAccountStore((s) => s.me);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"signOut" | "delete" | null>(null);

  const signOut = async () => {
    setBusy("signOut");
    try {
      await useAccountStore.getState().signOut();
    } catch (error) {
      toast.error(accountErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  const requestDeletion = async () => {
    setBusy("delete");
    try {
      await useAccountStore.getState().requestAccountDeletion();
      setConfirmDelete(false);
      toast.success(t("account.delete.sent"));
    } catch (error) {
      toast.error(accountErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section id="account" title={t("account.section")}>
      <div className="space-y-4 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        <p>{t("account.signedInAs", { email: me?.email ?? "" })}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void signOut()} loading={busy === "signOut"}>
            {t("account.signOut")}
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            {t("account.delete")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={requestDeletion}
        title={t("account.delete.confirmTitle")}
        body={t("account.delete.confirmBody")}
        confirmLabel={t("account.delete.send")}
        danger
        busy={busy === "delete"}
      />
    </Section>
  );
}
