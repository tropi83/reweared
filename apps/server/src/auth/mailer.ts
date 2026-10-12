import { createTransport } from "nodemailer";
import { Resend } from "resend";
import { AppError } from "@aiv/domain/models";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Transactional email (verification, password reset). Implementations never log a recipient or a link. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** `seller@example.com` → `s***@example.com`, for logs that must say who without saying who. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

interface ResendClient {
  emails: { send(payload: { from: string; to: string; subject: string; text: string; html: string }): Promise<{ error: { message: string } | null }> };
}

/** Production: Resend's API. The API key stays inside the client; failures surface as PROVIDER_UNAVAILABLE. */
export class ResendMailer implements Mailer {
  private readonly client: ResendClient;

  constructor(
    apiKey: string,
    private readonly from: string,
    client?: ResendClient,
  ) {
    this.client = client ?? new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<void> {
    let failure: string | undefined;
    try {
      const { error } = await this.client.emails.send({ from: this.from, ...message });
      if (error) failure = error.message;
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause);
    }
    if (failure !== undefined) {
      throw new AppError("PROVIDER_UNAVAILABLE", "The email could not be sent. Try again later.", { detail: `resend: ${failure}` });
    }
  }
}

/** Development: plain SMTP, pointed at Mailpit by compose.dev.yaml. */
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/** Tests: keeps the messages in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
