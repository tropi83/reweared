import type { FieldFillResult } from "@/domain/services/publish";
import { t } from "@/i18n";
import type { PublishSession } from "./stores/publish-store";

/** ✓ pasted · ⧉ icon waiting for a tap · ✗ field not found / failed — the marks the phone screens use. */
const MARK: Record<FieldFillResult, string> = { filled: "✓", ready: "⧉", not_found: "✗", failed: "✗" };

/**
 * The line shown in the status bar above vinted.com on desktop — the same guidance as the native
 * status line on phones, worded by the app (localized) and pushed to the window as plain text.
 */
export function publishBarText(session: PublishSession): string {
  if (session.error?.code === "TIMEOUT") return t("publish.bar.timeout");
  if (session.busy) return t("publish.bar.filling");
  const report = session.report;
  if (report && (session.stage === "form" || session.stage === "filled")) {
    if (!report.pageOk) return t("publish.bar.notForm");
    const params = { title: MARK[report.title], description: MARK[report.description], ...report.photos };
    return t(report.title === "ready" || report.description === "ready" ? "publish.bar.ready" : "publish.bar.filled", params);
  }
  switch (session.stage) {
    case "login":
      return t("publish.bar.login");
    case "form":
    case "filled":
      return t("publish.bar.filling");
    default:
      return t("publish.bar.browse");
  }
}
