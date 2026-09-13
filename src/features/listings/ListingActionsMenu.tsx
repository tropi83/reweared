import { useState, type ReactNode } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { deleteListing } from "@/app/listing-actions";
import { navigate } from "@/app/router";
import { useListingsStore } from "@/app/stores/listings-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";

/**
 * Rename / duplicate / delete a listing — on this device only, never on Vinted. One component for the
 * sidebar rows, the home cards and the workspace header, so every screen offers the same actions with
 * the same confirmation. The trigger is a real button (visible on touch screens; callers may fade it
 * in on hover for fine pointers through `className`).
 */
export function ListingActionsMenu({
  listing,
  className,
  align = "right",
}: {
  listing: { id: string; name: string };
  className?: string;
  align?: "left" | "right";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(listing.name);
  const { rename, duplicate } = useListingsStore.getState();

  const submitRename = async () => {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== listing.name) await rename(listing.id, next);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-label={t("listings.actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-md p-1.5 text-fg-subtle hover:bg-bg-sunken hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className={cn(
              "fade-in absolute top-full z-50 mt-1 w-44 rounded-lg border border-border bg-bg-elevated p-1 shadow-app",
              align === "right" ? "right-0" : "left-0",
            )}
            role="menu"
            aria-label={t("listings.actions")}
          >
            <MenuItem
              icon={<Pencil className="size-3.5" />}
              label={t("common.rename")}
              onClick={() => {
                setOpen(false);
                setName(listing.name);
                setRenaming(true);
              }}
            />
            <MenuItem
              icon={<Copy className="size-3.5" />}
              label={t("common.duplicate")}
              onClick={async () => {
                setOpen(false);
                const copy = await duplicate(listing.id);
                if (copy) navigate({ name: "listing", id: copy.listing.id });
              }}
            />
            <MenuItem
              icon={<Trash2 className="size-3.5" />}
              label={t("common.delete")}
              danger
              onClick={() => {
                setOpen(false);
                setDeleting(true);
              }}
            />
          </div>
        </>
      )}
      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t("listings.rename.title")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void submitRename()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitRename();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label={t("common.name")} />
        </form>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t("listings.delete.title")}
        body={t("listings.delete.body", { name: listing.name })}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={() => {
          setDeleting(false);
          void deleteListing(listing.id);
        }}
      />
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-bg-sunken", danger ? "text-danger" : "text-fg")}
    >
      {icon}
      {label}
    </button>
  );
}
