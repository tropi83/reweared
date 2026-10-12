import { useState, type FormEvent, type ReactNode } from "react";
import { useAccountStore } from "@/app/stores/account-store";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { useT } from "@/i18n";
import { accountErrorMessage } from "./account-errors";

export type AuthScreen =
  | { name: "signIn" }
  | { name: "signUp" }
  | { name: "forgot" }
  | { name: "checkEmail"; reason: "verify" | "reset"; email: string }
  | { name: "reset"; token: string }
  | { name: "resetDone" };

/** Sign-in, sign-up, password reset: what the app shows in API mode until a session exists. */
export function AuthScreens({ initial, initialError, onBackToSignIn }: { initial?: AuthScreen; initialError?: string; onBackToSignIn?: () => void }) {
  const [screen, setScreen] = useState<AuthScreen>(initial ?? { name: "signIn" });
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const go = (next: AuthScreen) => {
    setError(null);
    if (next.name === "signIn" && onBackToSignIn) return onBackToSignIn();
    setScreen(next);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-bg p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg-elevated p-6 shadow-app">
        <Screen screen={screen} go={go} run={run} busy={busy} />
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

interface ScreenProps {
  screen: AuthScreen;
  go: (next: AuthScreen) => void;
  run: (action: () => Promise<void>) => Promise<void>;
  busy: boolean;
}

function Screen({ screen, go, run, busy }: ScreenProps) {
  const t = useT();
  const account = useAccountStore.getState;
  switch (screen.name) {
    case "signIn":
      return (
        <CredentialsForm
          title={t("account.signIn.title")}
          submit={t("account.signIn")}
          busy={busy}
          onSubmit={(email, password) =>
            run(async () => {
              if ((await account().signIn(email, password)) === "verificationSent") go({ name: "checkEmail", reason: "verify", email });
            })
          }
          footer={
            <>
              <LinkButton onClick={() => go({ name: "forgot" })}>{t("account.forgot")}</LinkButton>
              <LinkButton onClick={() => go({ name: "signUp" })}>{t("account.toSignUp")}</LinkButton>
            </>
          }
        />
      );
    case "signUp":
      return (
        <CredentialsForm
          title={t("account.signUp.title")}
          submit={t("account.signUp")}
          busy={busy}
          newPassword
          onSubmit={(email, password) =>
            run(async () => {
              await account().signUp(email, password);
              go({ name: "checkEmail", reason: "verify", email });
            })
          }
          footer={<LinkButton onClick={() => go({ name: "signIn" })}>{t("account.toSignIn")}</LinkButton>}
        />
      );
    case "forgot":
      return <ForgotForm busy={busy} go={go} run={run} />;
    case "checkEmail":
      return (
        <div className="space-y-4">
          <Title>{t("account.checkEmail.title")}</Title>
          <p className="text-sm text-fg-muted">
            {t(screen.reason === "verify" ? "account.checkEmail.verify" : "account.checkEmail.reset", { email: screen.email })}
          </p>
          <LinkButton onClick={() => go({ name: "signIn" })}>{t("account.back")}</LinkButton>
        </div>
      );
    case "reset":
      return <ResetForm token={screen.token} busy={busy} go={go} run={run} />;
    case "resetDone":
      return (
        <div className="space-y-4">
          <Title>{t("account.reset.title")}</Title>
          <p className="text-sm text-fg-muted">{t("account.reset.done")}</p>
          <Button className="w-full" onClick={() => go({ name: "signIn" })}>
            {t("account.signIn")}
          </Button>
        </div>
      );
  }
}

function CredentialsForm({
  title,
  submit,
  busy,
  newPassword,
  onSubmit,
  footer,
}: {
  title: string;
  submit: string;
  busy: boolean;
  newPassword?: boolean;
  onSubmit: (email: string, password: string) => void;
  footer: ReactNode;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const send = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(email.trim(), password);
  };
  return (
    <form className="space-y-4" onSubmit={send}>
      <Title>{title}</Title>
      <p className="text-sm text-fg-muted">{t("account.tagline")}</p>
      <div className="space-y-1.5">
        <Label htmlFor="account-email">{t("account.email")}</Label>
        <Input id="account-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="account-password" {...(newPassword ? { hint: t("account.passwordHint") } : {})}>
          {t("account.password")}
        </Label>
        <Input
          id="account-password"
          type="password"
          autoComplete={newPassword ? "new-password" : "current-password"}
          required
          minLength={newPassword ? 10 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" loading={busy}>
        {submit}
      </Button>
      <div className="flex flex-col items-start gap-1">{footer}</div>
    </form>
  );
}

function ForgotForm({ busy, go, run }: Omit<ScreenProps, "screen">) {
  const t = useT();
  const [email, setEmail] = useState("");
  const send = (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    void run(async () => {
      await useAccountStore.getState().requestPasswordReset(address);
      go({ name: "checkEmail", reason: "reset", email: address });
    });
  };
  return (
    <form className="space-y-4" onSubmit={send}>
      <Title>{t("account.forgot.title")}</Title>
      <p className="text-sm text-fg-muted">{t("account.forgot.body")}</p>
      <div className="space-y-1.5">
        <Label htmlFor="account-email">{t("account.email")}</Label>
        <Input id="account-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" loading={busy}>
        {t("account.forgot.send")}
      </Button>
      <LinkButton onClick={() => go({ name: "signIn" })}>{t("account.back")}</LinkButton>
    </form>
  );
}

function ResetForm({ token, busy, go, run }: Omit<ScreenProps, "screen"> & { token: string }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const send = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await useAccountStore.getState().resetPassword(token, password);
      go({ name: "resetDone" });
    });
  };
  return (
    <form className="space-y-4" onSubmit={send}>
      <Title>{t("account.reset.title")}</Title>
      <div className="space-y-1.5">
        <Label htmlFor="account-new-password" hint={t("account.passwordHint")}>
          {t("account.newPassword")}
        </Label>
        <Input
          id="account-new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" loading={busy}>
        {t("account.reset.save")}
      </Button>
      <LinkButton onClick={() => go({ name: "signIn" })}>{t("account.back")}</LinkButton>
    </form>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-lg font-semibold tracking-tight">{children}</h1>;
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-accent hover:underline">
      {children}
    </button>
  );
}
