import type { ServerConfig } from "../config";
import { MemoryMailer, ResendMailer, SmtpMailer, type Mailer } from "./mailer";

export function createMailer(config: ServerConfig): Mailer {
  if (config.MAIL_MODE === "resend") return new ResendMailer(config.RESEND_API_KEY ?? "", config.MAIL_FROM);
  if (config.MAIL_MODE === "smtp") return new SmtpMailer(config.SMTP_URL ?? "", config.MAIL_FROM);
  return new MemoryMailer();
}
