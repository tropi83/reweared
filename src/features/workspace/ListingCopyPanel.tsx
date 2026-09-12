import { useState } from "react";
import { Check, Copy, FileText, RefreshCw, Square } from "lucide-react";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { useListingStore } from "@/app/stores/listing-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Misc";
import { LISTING_COPY_LIMITS } from "@/domain/services/listing-copy";
import { MOCK_PROVIDER_ID } from "@/infrastructure/providers/mock/MockImageProvider";
import { useT, type MessageKey } from "@/i18n";

/** Title + description generated from the original photo, editable and copyable. */
export function ListingCopyPanel() {
  const t = useT();
  const doc = useProjectsStore((s) => s.current);
  const providerId = useComposerStore((s) => s.providerId);
  const providerStatus = useAuthStore((s) => s.providerStatus);
  const busy = useListingStore((s) => s.copyBusy);
  const error = useListingStore((s) => s.copyError);
  const generateCopy = useListingStore((s) => s.generateCopy);
  const updateCopy = useListingStore((s) => s.updateCopy);
  const cancelCopy = useListingStore((s) => s.cancelCopy);
  const [copied, setCopied] = useState<"title" | "description" | "all" | null>(null);

  if (!doc?.project.originalImageId) return null;
  const copy = doc.project.copy;
  // The mock provider has no vision model; use Cloudflare/Gemini credentials when configured.
  const copyProviderId =
    providerId === MOCK_PROVIDER_ID
      ? Object.entries(providerStatus).find(([id, s]) => id !== MOCK_PROVIDER_ID && s.state === "authenticated")?.[0]
      : providerId;
  const canGenerate = !!copyProviderId && providerStatus[copyProviderId]?.state === "authenticated";

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
        {busy ? (
          <Button variant="ghost" size="sm" leftIcon={<Square className="size-3.5" />} onClick={cancelCopy}>
            {t("common.cancel")}
          </Button>
        ) : (
          <Button
            variant={copy ? "ghost" : "secondary"}
            size="sm"
            leftIcon={<RefreshCw className="size-3.5" />}
            disabled={!canGenerate}
            onClick={() => copyProviderId && void generateCopy(copyProviderId)}
            title={canGenerate ? undefined : t("copy.needProvider")}
          >
            {copy ? t("copy.regenerate") : t("copy.generate")}
          </Button>
        )}
      </div>

      {busy && <div className="shimmer h-16 rounded-lg" aria-busy />}
      {error && !busy && (
        <p className="text-xs text-danger" role="alert">
          {t(`error.${error.code}` as MessageKey)}
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
