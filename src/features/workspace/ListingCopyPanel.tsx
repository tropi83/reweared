import { useState } from "react";
import { Check, Copy, FileText, RefreshCw, Settings2, Square } from "lucide-react";
import { navigate } from "@/app/router";
import { getServices } from "@/app/services";
import { useAuthStatus } from "@/app/query/auth-status";
import { useListingSetupStore } from "@/app/stores/listing-setup-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Misc";
import { LISTING_COPY_LIMITS, resolveCopyModel } from "@/domain/services/listing-copy";
import { useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";

/** Title + description generated from the original photo, editable and copyable. */
export function ListingCopyPanel() {
  const t = useT();
  const doc = useListingsStore((s) => s.current);
  const settings = useSettingsStore((s) => s.settings);
  const busy = useListingSetupStore((s) => s.copyBusy);
  const error = useListingSetupStore((s) => s.copyError);
  const generateCopy = useListingSetupStore((s) => s.generateCopy);
  const updateCopy = useListingSetupStore((s) => s.updateCopy);
  const cancelCopy = useListingSetupStore((s) => s.cancelCopy);
  const [copied, setCopied] = useState<"title" | "description" | "all" | null>(null);
  const copyProviders = [...getServices().copyProviders.values()];
  const copyProviderId = settings.copyProviderId;
  const provider = getServices().copyProviders.get(copyProviderId) ?? copyProviders[0];
  const canGenerate = useAuthStatus(provider?.id ?? "")?.state === "authenticated";

  if (!doc?.listing.originalImageId) return null;
  const copy = doc.listing.copy;
  const model = provider ? resolveCopyModel(provider, settings.copyModelByProvider[provider.id]) : undefined;

  const copyText = async (what: "title" | "description" | "all") => {
    if (!copy) return;
    const text = what === "title" ? copy.title : what === "description" ? copy.description : `${copy.title}\n\n${copy.description}`;
    await navigator.clipboard?.writeText(text);
    setCopied(what);
    toast.info(t("common.copied"));
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section className="space-y-2" aria-label={t("copy.title")}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <FileText className="size-3.5" /> {t("copy.title")}
        </span>
        <div className="flex items-center gap-1">
          {/* The provider and model are chosen in Settings → Models. */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("models.change")}
            title={model ? `${provider?.displayName} · ${model.label}` : undefined}
            onClick={() => navigate({ name: "settings", section: "models" })}
          >
            <Settings2 className="size-3.5" />
          </Button>
          {busy ? (
            <Button variant="ghost" size="sm" leftIcon={<Square className="size-3.5" />} onClick={cancelCopy}>
              {t("common.cancel")}
            </Button>
          ) : copy ? (
            // The first text comes from "Create the listing"; this only rewrites it.
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw className="size-3.5" />}
              disabled={!canGenerate}
              onClick={() => void generateCopy()}
              title={canGenerate ? undefined : t("copy.needProvider", { provider: provider?.displayName ?? "" })}
            >
              {t("copy.regenerateText")}
            </Button>
          ) : null}
        </div>
      </div>

      {busy && <div className="shimmer h-16 rounded-lg" aria-busy />}
      {error && !busy && (
        <p className="text-xs text-danger" role="alert">
          {errorMessage(error, copyProviderId)}
          {error.detail ? <span className="text-fg-subtle"> — {error.detail}</span> : null}
        </p>
      )}

      {copy && !busy && (
        <div className="space-y-2 rounded-lg border border-border bg-bg-elevated/60 p-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="copy-title" hint={`${copy.title.length}/${LISTING_COPY_LIMITS.title}`}>
                {t("copy.field.title")}
              </Label>
              <button type="button" className="text-fg-subtle hover:text-fg" onClick={() => void copyText("title")} aria-label={t("common.copy")}>
                {copied === "title" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <Input
              id="copy-title"
              value={copy.title}
              maxLength={LISTING_COPY_LIMITS.title}
              onChange={(e) => updateCopy({ title: e.target.value })}
              className="h-8 font-medium"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="copy-description">{t("copy.field.description")}</Label>
              <button type="button" className="text-fg-subtle hover:text-fg" onClick={() => void copyText("description")} aria-label={t("common.copy")}>
                {copied === "description" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <Textarea
              id="copy-description"
              rows={6}
              value={copy.description}
              maxLength={LISTING_COPY_LIMITS.description}
              onChange={(e) => updateCopy({ description: e.target.value })}
              className="text-xs leading-relaxed"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Attributes are labelled; only the search keywords are hashtags. */}
            {copy.condition && <Badge tone="accent">{t("copy.attr.condition", { value: t(`copy.condition.${copy.condition}` as MessageKey) })}</Badge>}
            {copy.brand && <Badge tone="accent">{t("copy.attr.brand", { value: copy.brand })}</Badge>}
            {copy.color && <Badge tone="accent">{t("copy.attr.color", { value: copy.color })}</Badge>}
            {copy.keywords.map((k) => (
              <Badge key={k}>#{k}</Badge>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-fg-subtle">{t("copy.disclaimer")}</span>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={copied === "all" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              onClick={() => void copyText("all")}
            >
              {t("copy.copyAll")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
