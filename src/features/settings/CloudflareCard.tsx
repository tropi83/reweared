import { useState } from "react";
import { CheckCircle2, Cloud, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/app/stores/auth-store";
import { toast } from "@/app/stores/toast-store";
import { getServices } from "@/app/services";
import { Button } from "@/components/ui/Button";
import { Input, Label, Switch } from "@/components/ui/Input";
import { Badge, Segmented } from "@/components/ui/Misc";
import { toGenerationError, type AuthStatus } from "@/domain/models";
import type { CloudflareMode } from "@/infrastructure/providers/cloudflare/CloudflareAuth";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { openExternal } from "@/lib/open-external";

const CF_TOKEN_URL = "https://dash.cloudflare.com/?to=/:account/ai/workers-ai";
const CF_WORKER_TEMPLATE_URL = "https://github.com/tropi83/reweared/tree/main/cloudflare-worker";

function StatusBadge({ status }: { status: AuthStatus | undefined }) {
  const t = useT();
  const state = status?.state ?? "unauthenticated";
  const map: Record<AuthStatus["state"], { key: MessageKey; tone: "success" | "neutral" | "warning" | "danger" }> = {
    authenticated: { key: "auth.status.connected", tone: "success" },
    unauthenticated: { key: "auth.status.disconnected", tone: "neutral" },
    expired: { key: "auth.status.expired", tone: "warning" },
    invalid: { key: "auth.status.invalid", tone: "danger" },
  };
  return <Badge tone={map[state].tone}>{t(map[state].key)}</Badge>;
}

/** Cloudflare Workers AI credentials: direct API (desktop) or the user's own Worker (any platform). */
export function CloudflareCard() {
  const t = useT();
  const auth = useAuthStore();
  const status = auth.providerStatus.cloudflare;
  const platform = getPlatform();
  const directSupported = getServices().cloudflareAuth.directSupported;
  const [mode, setMode] = useState<CloudflareMode>(directSupported ? "direct" : "worker");
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [workerUrl, setWorkerUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(false);
  const connected = status?.state === "authenticated" || status?.state === "invalid";

  const save = async () => {
    try {
      if (mode === "direct") await auth.saveCloudflareDirect(accountId, token, remember);
      else await auth.saveCloudflareWorker(workerUrl, secret, remember);
      setToken("");
      setSecret("");
      toast.success(t("cf.saved"));
      const ok = await auth.testCloudflare();
      if (ok) toast.success(t("auth.apiKey.testOk"));
    } catch (err) {
      toast.error(toGenerationError(err).message);
    }
  };

  return (
    <div className={cn("rounded-xl border bg-bg-elevated p-4", status?.state === "authenticated" ? "border-accent/50" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2">
        <Cloud className="size-4 text-fg-muted" />
        <h3 className="text-base font-semibold">{t("cf.title")}</h3>
        <StatusBadge status={status} />
        <Badge tone="success">{t("cf.pricing")}</Badge>
        {status?.label && <span className="text-xs text-fg-muted">{status.label}</span>}
      </div>
      <p className="mt-1 text-sm text-fg-muted">{t("cf.body")}</p>

      {connected ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-success" />
            {status?.label}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void auth.testCloudflare().then((ok) => ok && toast.success(t("auth.apiKey.testOk")))} loading={auth.busy}>
              {t("auth.apiKey.test")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void auth.clearCloudflare()}>
              {t("cf.disconnect")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Segmented<CloudflareMode>
            ariaLabel={t("cf.mode")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "direct", label: t("cf.mode.direct"), disabled: !directSupported, title: directSupported ? undefined : t("cf.mode.directUnavailable") },
              { value: "worker", label: t("cf.mode.worker") },
            ]}
          />
          {!directSupported && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">{t("cf.mode.directUnavailable")}</p>}
          {mode === "direct" ? (
            <>
              <p className="text-xs text-fg-muted">{t("cf.direct.help")}</p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                onClick={() => void openExternal(CF_TOKEN_URL)}
              >
                {t("cf.direct.openDashboard")} <ExternalLink className="size-3" />
              </button>
              <div className="space-y-1.5">
                <Label htmlFor="cf-account">{t("cf.accountId")}</Label>
                <Input
                  id="cf-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="0123456789abcdef0123456789abcdef"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-token">{t("cf.token")}</Label>
                <Input
                  id="cf-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("cf.tokenPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-fg-muted">{t("cf.worker.help")}</p>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                onClick={() => void openExternal(CF_WORKER_TEMPLATE_URL)}
              >
                {t("cf.worker.template")} <ExternalLink className="size-3" />
              </button>
              <div className="space-y-1.5">
                <Label htmlFor="cf-worker">{t("cf.workerUrl")}</Label>
                <Input
                  id="cf-worker"
                  value={workerUrl}
                  onChange={(e) => setWorkerUrl(e.target.value)}
                  placeholder="https://aiv.your-name.workers.dev"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf-secret" hint={t("cf.optional")}>
                  {t("cf.workerSecret")}
                </Label>
                <Input id="cf-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
              </div>
            </>
          )}
          <div>
            <Switch checked={remember} onChange={setRemember} label={t("auth.apiKey.remember")} />
            <p className="mt-1 text-[11px] text-fg-subtle">
              {platform.secureStorage ? t("auth.apiKey.rememberHelp.native") : t("auth.apiKey.rememberHelp.web")}
            </p>
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={auth.busy}
            disabled={mode === "direct" ? accountId.trim().length < 32 || token.trim().length < 20 : workerUrl.trim().length < 12}
          >
            {t("common.save")} · {t("auth.apiKey.test")}
          </Button>
        </form>
      )}
    </div>
  );
}
