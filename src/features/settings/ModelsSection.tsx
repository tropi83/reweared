import { Image, Type } from "lucide-react";
import { getServices, MOCK_ENABLED } from "@/app/services";
import { navigate } from "@/app/router";
import { useAuthStore } from "@/app/stores/auth-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ModelInfo } from "@/domain/models";
import { resolveCopyModel, type ListingCopyModel } from "@/domain/services/listing-copy";
import { useT, type MessageKey } from "@/i18n";
import { useComposerDefaults, useComposerModels } from "../workspace/useComposerDefaults";
import { Section } from "./SettingsView";

/** Catalogue tiers ("Fast", "Professional"…) are not names: show the id instead. */
export function modelLabel(m: ModelInfo): string {
  return /^(Fast|Balanced|Professional|Legacy)$/.test(m.displayName) ? m.id : m.displayName;
}

/** Settings → Models: which provider and model make the photos, and which write the title & description. */
export function ModelsSection() {
  const t = useT();
  return (
    <Section id="models" title={t("settings.section.models")}>
      <div className="space-y-4">
        <ImageModelCard />
        <TextModelCard />
      </div>
    </Section>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
      <legend className="inline-flex items-center gap-1.5 px-1 text-sm font-medium">
        {icon} {title}
      </legend>
      {children}
    </fieldset>
  );
}

function ImageModelCard() {
  const t = useT();
  const { composer, providers, models } = useComposerModels();
  const updateSettings = useSettingsStore((s) => s.update);
  useComposerDefaults();
  const providerId = composer.providerId;
  const showProvider = providers.length > 1 || MOCK_ENABLED;

  const changeProvider = (id: string) => {
    composer.setProvider(id);
    void updateSettings({ activeProviderId: id });
  };
  const changeModel = (id: string) => {
    composer.setModel(id);
    void updateSettings({ lastModelByProvider: { ...useSettingsStore.getState().settings.lastModelByProvider, [providerId]: id } });
  };

  return (
    <Card title={t("models.images")} icon={<Image className="size-4 text-fg-muted" />}>
      <p className="text-xs text-fg-muted">{t("models.imagesHelp")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {showProvider && (
          <div className="space-y-1.5">
            <Label htmlFor="image-provider">{t("composer.provider")}</Label>
            <Select
              id="image-provider"
              value={providerId}
              options={providers.map((p) => ({ value: p.info.id, label: p.info.displayName }))}
              onChange={changeProvider}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="image-model">{t("composer.model")}</Label>
          <Select
            id="image-model"
            value={composer.modelId ?? ""}
            options={models.map((m) => ({
              value: m.id,
              label: modelLabel(m),
              description: `${t(`composer.modelTier.${m.tier}` as MessageKey)}${!m.available ? ` · ${t("composer.modelUnavailable")}` : ""}`,
              disabled: !m.available,
            }))}
            onChange={changeModel}
          />
        </div>
      </div>
    </Card>
  );
}

function TextModelCard() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const providerStatus = useAuthStore((s) => s.providerStatus);
  const copyProviders = [...getServices().copyProviders.values()];
  const provider = getServices().copyProviders.get(settings.copyProviderId) ?? copyProviders[0];
  const model = provider ? resolveCopyModel(provider, settings.copyModelByProvider[provider.id]) : undefined;
  const connected = !!provider && providerStatus[provider.id]?.state === "authenticated";
  const pricing = (m: ListingCopyModel) =>
    m.pricing ? t("copy.pricing", { input: m.pricing.inputPerM, output: m.pricing.outputPerM, free: m.freeTier ? t("copy.freeTier") : "" }) : "";

  if (!provider || !model) return null;
  return (
    <Card title={t("copy.title")} icon={<Type className="size-4 text-fg-muted" />}>
      <p className="text-xs text-fg-muted">{t("models.textHelp")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="copy-provider">{t("copy.provider")}</Label>
          <Select
            id="copy-provider"
            value={provider.id}
            options={copyProviders.map((p) => ({ value: p.id, label: p.displayName }))}
            onChange={(copyProviderId) => void updateSettings({ copyProviderId })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="copy-model">{t("copy.model")}</Label>
          <Select
            id="copy-model"
            value={model.id}
            options={provider.models.map((m) => ({ value: m.id, label: m.label, description: pricing(m) }))}
            onChange={(id) => void updateSettings({ copyModelByProvider: { ...settings.copyModelByProvider, [provider.id]: id } })}
          />
          <p className="text-[11px] text-fg-subtle">{pricing(model)}</p>
        </div>
      </div>
      {!connected && (
        <p className="text-xs text-warning">
          {t("copy.needProvider", { provider: provider.displayName })}{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => navigate({ name: "settings", section: "providers" })}>
            {t("settings.section.providers")}
          </button>
        </p>
      )}
    </Card>
  );
}
