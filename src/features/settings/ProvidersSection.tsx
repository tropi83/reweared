import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, LogOut, ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/app/stores/auth-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { GEMINI_IMAGE_GENERATION_ENABLED, getServices, MOCK_ENABLED } from "@/app/services";
import { Button } from "@/components/ui/Button";
import { Input, Label, Switch } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Misc";
import { toGenerationError, type AuthStatus } from "@/domain/models";
import type { GoogleCloudProject } from "@/infrastructure/auth/GoogleOAuthCredentialProvider";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import type { MockScenario } from "@/infrastructure/providers/mock/MockImageProvider";
import { useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { cn } from "@/lib/cn";
import { openExternal } from "@/lib/open-external";
import { CloudflareCard } from "./CloudflareCard";
import { Section } from "./SettingsView";

const AI_STUDIO_KEYS_URL = "https://aistudio.google.com/api-keys";
const AI_STUDIO_BILLING_URL = "https://aistudio.google.com/plan_information";

function StatusBadge({ status }: { status: AuthStatus }) {
  const t = useT();
  const map: Record<AuthStatus["state"], { key: MessageKey; tone: "success" | "neutral" | "warning" | "danger" }> = {
    authenticated: { key: "auth.status.connected", tone: "success" },
    unauthenticated: { key: "auth.status.disconnected", tone: "neutral" },
    expired: { key: "auth.status.expired", tone: "warning" },
    invalid: { key: "auth.status.invalid", tone: "danger" },
  };
  const entry = map[status.state];
  return <Badge tone={entry.tone}>{t(entry.key)}</Badge>;
}

export function ProvidersSection() {
  const t = useT();
  const auth = useAuthStore();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const platform = getPlatform();
  const isWeb = !platform.isTauri;
  const disclaimerNeeded = isWeb && !settings.webCredentialDisclaimerAccepted;

  return (
    <Section id="providers" title={t("settings.section.providers")}>
      <CloudflareCard />
      <div className="rounded-xl border border-border bg-bg-elevated p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{t("auth.gemini.title")}</h3>
          <StatusBadge status={auth.status} />
          {auth.status.label && <span className="text-xs text-fg-muted">{auth.status.label}</span>}
        </div>
        <p className="mt-1 text-sm text-fg-muted">{t("auth.gemini.body")}</p>
        <div className="mt-2 space-y-1.5 rounded-lg bg-bg-sunken px-3 py-2 text-xs text-fg-muted">
          {!GEMINI_IMAGE_GENERATION_ENABLED && <p>{t("auth.gemini.copyOnly")}</p>}
          <p>{t("auth.billing.notice")}</p>
          <p>
            {GEMINI_IMAGE_GENERATION_ENABLED && <>{t("auth.billing.noFreeTier")} </>}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-accent hover:underline"
              onClick={() => void openExternal(AI_STUDIO_BILLING_URL)}
            >
              {t("auth.billing.setup")} <ExternalLink className="size-3" />
            </button>
          </p>
        </div>

        {disclaimerNeeded && (
          <div className="mt-3 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="space-y-2">
              <p>{t("auth.web.disclaimer")}</p>
              <Button size="sm" onClick={() => void updateSettings({ webCredentialDisclaimerAccepted: true })}>
                {t("auth.web.acknowledge")}
              </Button>
            </div>
          </div>
        )}

        <div className={cn("mt-4 grid gap-4 lg:grid-cols-2", disclaimerNeeded && "pointer-events-none opacity-50")}>
          <GoogleCard />
          <ApiKeyCard />
        </div>

        {auth.lastError && (
          <p className="mt-3 text-sm text-danger" role="alert">
            {errorMessage(auth.lastError, "gemini")}
            {auth.lastError.detail ? <span className="text-fg-subtle"> — {auth.lastError.detail}</span> : null}
          </p>
        )}
      </div>

      {MOCK_ENABLED && <MockCard />}
    </Section>
  );
}

function GoogleCard() {
  const t = useT();
  const auth = useAuthStore();
  const oauth = getServices().auth.oauth;
  const [projects, setProjects] = useState<GoogleCloudProject[] | null>(null);
  const [manualProject, setManualProject] = useState(auth.oauthStatus.projectId ?? "");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const connected = auth.oauthStatus.state === "authenticated";
  const active = getServices().auth.activeKind === "oauth";

  const [seenProjectId, setSeenProjectId] = useState(auth.oauthStatus.projectId);
  if (seenProjectId !== auth.oauthStatus.projectId) {
    setSeenProjectId(auth.oauthStatus.projectId);
    setManualProject(auth.oauthStatus.projectId ?? "");
  }

  const signIn = async () => {
    abortRef.current = new AbortController();
    try {
      await auth.signInWithGoogle(abortRef.current.signal);
    } catch (err) {
      const error = toGenerationError(err);
      if (error.code === "CANCELLED") toast.info(t("auth.google.cancelled"));
    }
  };

  const loadProjects = async () => {
    setLoadingProjects(true);
    try {
      setProjects(await auth.listProjects());
    } catch (err) {
      toast.error(toGenerationError(err).message);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  };

  return (
    <div className={cn("rounded-lg border p-3", active && connected ? "border-accent/50" : "border-border")}>
      <div className="flex items-center gap-2">
        <GoogleG />
        <span className="font-medium">Google</span>
        <StatusBadge status={auth.oauthStatus} />
      </div>
      {!oauth.isConfigured ? (
        <p className="mt-2 text-xs text-fg-muted">{t("auth.google.notConfigured")}</p>
      ) : !oauth.isSupported ? (
        <p className="mt-2 text-xs text-fg-muted">{t("auth.google.unsupportedPlatform")}</p>
      ) : connected ? (
        <div className="mt-3 space-y-3">
          {auth.oauthStatus.label && <p className="text-sm">{t("auth.google.signedInAs", { label: auth.oauthStatus.label })}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="gcp-project">{t("auth.google.project")}</Label>
            <p className="text-xs text-fg-muted">{t("auth.google.projectHelp")}</p>
            {projects && projects.length > 0 ? (
              <Select
                id="gcp-project"
                value={auth.oauthStatus.projectId ?? ""}
                placeholder={t("auth.google.selectProject")}
                options={projects.map((p) => ({ value: p.projectId, label: p.name, description: p.projectId }))}
                onChange={(id) => void auth.setProjectId(id || undefined).catch((err) => toast.error(toGenerationError(err).message))}
              />
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void auth.setProjectId(manualProject || undefined).catch((err) => toast.error(toGenerationError(err).message));
                }}
              >
                <Input
                  id="gcp-project"
                  value={manualProject}
                  onChange={(e) => setManualProject(e.target.value)}
                  placeholder={t("auth.google.projectPlaceholder")}
                  aria-label={t("auth.google.manualProject")}
                />
                <Button type="submit" size="md">
                  {t("common.save")}
                </Button>
              </form>
            )}
            <Button variant="ghost" size="sm" onClick={() => void loadProjects()} loading={loadingProjects}>
              {t("auth.google.loadProjects")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {!active && (
              <Button size="sm" variant="primary" onClick={() => void auth.setActiveKind("oauth")}>
                {t("common.select")}
              </Button>
            )}
            <Button size="sm" onClick={() => void auth.testConnection().then((ok) => ok && toast.success(t("auth.apiKey.testOk")))} loading={auth.busy}>
              {t("auth.apiKey.test")}
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<LogOut className="size-3.5" />} onClick={() => void auth.signOutGoogle()}>
              {t("auth.google.disconnect")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="primary" className="w-full" onClick={() => void signIn()} loading={auth.busy} leftIcon={<GoogleG mono />}>
            {auth.busy ? t("auth.google.connecting") : t("auth.google.continue")}
          </Button>
          {auth.busy && (
            <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => abortRef.current?.abort()}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ApiKeyCard() {
  const t = useT();
  const auth = useAuthStore();
  const platform = getPlatform();
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(false);
  const hasKey = auth.apiKeyStatus.state !== "unauthenticated";
  const active = getServices().auth.activeKind === "api_key";

  const [seenRemembered, setSeenRemembered] = useState(auth.apiKeyRemembered);
  if (seenRemembered !== auth.apiKeyRemembered) {
    setSeenRemembered(auth.apiKeyRemembered);
    setRemember(auth.apiKeyRemembered);
  }

  const save = async () => {
    try {
      await auth.saveApiKey(value, remember);
      setValue("");
      toast.success(t("auth.apiKey.saved"));
      const ok = await auth.testConnection();
      if (ok) toast.success(t("auth.apiKey.testOk"));
    } catch (err) {
      toast.error(toGenerationError(err).message);
    }
  };

  return (
    <div className={cn("rounded-lg border p-3", active && hasKey ? "border-accent/50" : "border-border")}>
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-fg-muted" />
        <span className="font-medium">{t("auth.apiKey.title")}</span>
        <StatusBadge status={auth.apiKeyStatus} />
      </div>
      <p className="mt-1 text-xs text-fg-muted">{t("auth.apiKey.body")}</p>
      <button
        type="button"
        className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
        onClick={() => void openExternal(AI_STUDIO_KEYS_URL)}
      >
        {t("auth.apiKey.getKey")} <ExternalLink className="size-3" />
      </button>

      {hasKey ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-success" />
            {t("auth.apiKey.masked", { suffix: auth.apiKeyStatus.label ?? "" })}
          </div>
          <div className="flex flex-wrap gap-2">
            {!active && (
              <Button size="sm" variant="primary" onClick={() => void auth.setActiveKind("api_key")}>
                {t("common.select")}
              </Button>
            )}
            <Button size="sm" onClick={() => void auth.testConnection().then((ok) => ok && toast.success(t("auth.apiKey.testOk")))} loading={auth.busy}>
              {t("auth.apiKey.test")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void auth.removeApiKey()}>
              {t("auth.apiKey.remove")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("auth.apiKey.placeholder")}
            aria-label={t("auth.apiKey.title")}
          />
          <div>
            <Switch checked={remember} onChange={setRemember} label={t("auth.apiKey.remember")} />
            <p className="mt-1 text-[11px] text-fg-subtle">
              {platform.secureStorage ? t("auth.apiKey.rememberHelp.native") : t("auth.apiKey.rememberHelp.web")}
            </p>
          </div>
          <Button type="submit" variant="primary" disabled={value.trim().length < 20} loading={auth.busy}>
            {t("common.save")} · {t("auth.apiKey.test")}
          </Button>
        </form>
      )}
    </div>
  );
}

function MockCard() {
  const t = useT();
  const [scenario, setScenario] = useState<MockScenario>("success");
  const [latency, setLatency] = useState(1200);
  const mock = getServices().mock;
  useEffect(() => mock.setOptions({ scenario, latencyMs: latency }), [mock, scenario, latency]);
  return (
    <div className="rounded-xl border border-dashed border-border p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{t("auth.mock.title")}</h3>
        <Badge>DEV</Badge>
      </div>
      <p className="mt-1 text-sm text-fg-muted">{t("auth.mock.body")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mock-scenario">{t("auth.mock.scenario")}</Label>
          <Select<MockScenario>
            id="mock-scenario"
            value={scenario}
            options={(["success", "slow", "flaky", "rate_limited", "timeout", "error", "no_image"] as MockScenario[]).map((s) => ({ value: s, label: s }))}
            onChange={setScenario}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mock-latency" hint={`${latency} ms`}>
            Latency
          </Label>
          <input
            id="mock-latency"
            type="range"
            min={100}
            max={6000}
            step={100}
            value={latency}
            onChange={(e) => setLatency(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
        </div>
      </div>
    </div>
  );
}

function GoogleG({ mono }: { mono?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill={mono ? "currentColor" : "#4285F4"}
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill={mono ? "currentColor" : "#34A853"}
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill={mono ? "currentColor" : "#FBBC05"}
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill={mono ? "currentColor" : "#EA4335"}
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
