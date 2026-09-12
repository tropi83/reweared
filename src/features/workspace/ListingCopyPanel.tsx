import { useState } from "react";
import { Check, Copy, FileText, RefreshCw, Settings2, Square } from "lucide-react";
import { navigate } from "@/app/router";
import { getServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useListingStore } from "@/app/stores/listing-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Misc";
import { Select } from "@/components/ui/Select";
import { LISTING_COPY_LIMITS, resolveCopyModel, type ListingCopyModel } from "@/domain/services/listing-copy";
import { useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";

/** Title + description generated from the original photo, editable and copyable. */
export function ListingCopyPanel() {
  const t = useT();
  const doc = useProjectsStore((s) => s.current);
  const providerStatus = useAuthStore((s) => s.providerStatus);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const busy = useListingStore((s) => s.copyBusy);
  const error = useListingStore((s) => s.copyError);
  const generateCopy = useListingStore((s) => s.generateCopy);
  const updateCopy = useListingStore((s) => s.updateCopy);
  const cancelCopy = useListingStore((s) => s.cancelCopy);
  const [copied, setCopied] = useState<"title" | "description" | "all" | null>(null);
  const [showModel, setShowModel] = useState(false);

  if (!doc?.project.originalImageId) return null;
  const copy = doc.project.copy;
  const copyProviders = [...getServices().copyProviders.values()];
  const copyProviderId = settings.copyProviderId;
  const provider = getServices().copyProviders.get(copyProviderId) ?? copyProviders[0];
  const model = provider ? resolveCopyModel(provider, settings.copyModelByProvider[provider.id]) : undefined;
  const canGenerate = !!provider && providerStatus[provider.id]?.state === "authenticated";
  const pricing = (m: ListingCopyModel) =>
    m.pricing ? t("copy.pricing", { input: m.pricing.inputPerM, output: m.pricing.outputPerM, free: m.freeTier ? t("copy.freeTier") : "" }) : "";

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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("copy.model")}
            aria-pressed={showModel}
            title={model ? `${provider?.displayName} · ${model.label}` : undefined}
            onClick={() => setShowModel((v) => !v)}
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

      {showModel && provider && model && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-bg-elevated/60 p-2.5">
          <div className="space-y-1">
            <Label htmlFor="copy-provider">{t("copy.provider")}</Label>
            <Select
              id="copy-provider"
              value={provider.id}
              options={copyProviders.map((p) => ({ value: p.id, label: p.displayName }))}
              onChange={(copyProviderId) => void updateSettings({ copyProviderId })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="copy-model">{t("copy.model")}</Label>
            <Select
              id="copy-model"
              value={model.id}
              options={provider.models.map((m) => ({ value: m.id, label: m.label, description: pricing(m) }))}
              onChange={(id) => void updateSettings({ copyModelByProvider: { ...settings.copyModelByProvider, [provider.id]: id } })}
            />
          </div>
          {!canGenerate && (
            <p className="col-span-2 text-xs text-warning">
              {t("copy.needProvider", { provider: provider.displayName })}{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => navigate({ name: "settings", section: "providers" })}>
                {t("nav.settings")}
              </button>
            </p>
          )}
        </div>
      )}

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
            {copy.condition && <Badge tone="accent">{t(`copy.condition.${copy.condition}` as MessageKey)}</Badge>}
            {copy.brand && <Badge>{copy.brand}</Badge>}
            {copy.color && <Badge>{copy.color}</Badge>}
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
