import { useEffect, useMemo } from "react";
import { getServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { ALL_ASPECT_RATIOS, type AspectRatio } from "@/domain/models";

/** Derived model data of the composer's image provider (no side effects). */
export function useComposerModels() {
  const composer = useComposerStore();
  const modelsByProvider = useGenerationStore((s) => s.modelsByProvider);
  const providers = [...getServices().providers.values()];
  const models = useMemo(() => modelsByProvider[composer.providerId] ?? [], [modelsByProvider, composer.providerId]);
  const model = models.find((m) => m.id === composer.modelId);
  const aspectOptions = useMemo<AspectRatio[]>(
    () => ALL_ASPECT_RATIOS.filter((r) => r === "original" || model?.capabilities.supportedAspectRatios.includes(r)),
    [model],
  );
  const sizeOptions = useMemo(() => model?.capabilities.supportedImageSizes ?? [], [model]);
  return { composer, providers, models, model, aspectOptions, sizeOptions };
}

/**
 * Keeps the composer on a usable provider/model/format. Mounted by the always-visible listing card, so it
 * runs even while "Advanced options" is collapsed. The effects only call store actions.
 */
export function useComposerDefaults(): void {
  const { composer, models, model, aspectOptions, sizeOptions } = useComposerModels();
  const settings = useSettingsStore((s) => s.settings);
  const authStatus = useAuthStore((s) => s.providerStatus[composer.providerId]);
  const loadModels = useGenerationStore((s) => s.loadModels);
  const providerId = composer.providerId;

  useEffect(() => {
    void loadModels(providerId, true);
  }, [providerId, authStatus?.state, authStatus?.projectId, loadModels]);

  useEffect(() => {
    if (models.length === 0) return;
    const preferred = composer.modelId ?? settings.lastModelByProvider[providerId];
    const valid = models.find((m) => m.id === preferred && m.available) ?? models.find((m) => m.available) ?? models[0];
    if (valid && valid.id !== composer.modelId) composer.setModel(valid.id);
  }, [models, composer, providerId, settings.lastModelByProvider]);

  useEffect(() => {
    composer.setAspectRatio(settings.defaultAspectRatio);
    if (settings.defaultImageSize) composer.setImageSize(settings.defaultImageSize);
    if (getServices().providers.has(settings.activeProviderId)) composer.setProvider(settings.activeProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!model) return;
    if (!aspectOptions.includes(composer.aspectRatio)) composer.setAspectRatio("original");
    if (composer.imageSize && !sizeOptions.includes(composer.imageSize)) composer.setImageSize(undefined);
  }, [model, aspectOptions, sizeOptions, composer]);
}
