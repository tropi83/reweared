import type { Locale } from "@aiv/domain/models";
import type { MailMessage } from "./mailer";

export type AccountEmail = "verify" | "reset" | "delete";

const COPY: Record<Locale, Record<AccountEmail, { subject: string; intro: string; action: string; outro: string }>> = {
  en: {
    verify: {
      subject: "Confirm your email address",
      intro: "Welcome to AI Image Variations. Confirm your email address to start creating listings:",
      action: "Confirm my email",
      outro: "If you did not create an account, ignore this email.",
    },
    reset: {
      subject: "Reset your password",
      intro: "Someone asked to reset the password of your AI Image Variations account. To choose a new password:",
      action: "Choose a new password",
      outro: "If it was not you, ignore this email: your password stays the same.",
    },
    delete: {
      subject: "Confirm the deletion of your account",
      intro:
        "You asked to delete your AI Image Variations account. Your listings and photos will be erased for good. To confirm, open this link in the same browser or app:",
      action: "Delete my account",
      outro: "If you did not ask for this, ignore this email and change your password: your account stays as it is.",
    },
  },
  fr: {
    verify: {
      subject: "Confirmez votre adresse e-mail",
      intro: "Bienvenue sur AI Image Variations. Confirmez votre adresse e-mail pour commencer à créer des annonces :",
      action: "Confirmer mon e-mail",
      outro: "Si vous n’avez pas créé de compte, ignorez cet e-mail.",
    },
    reset: {
      subject: "Réinitialisez votre mot de passe",
      intro: "Une demande de réinitialisation du mot de passe de votre compte AI Image Variations a été faite. Pour en choisir un nouveau :",
      action: "Choisir un nouveau mot de passe",
      outro: "Si ce n’est pas vous, ignorez cet e-mail : votre mot de passe reste inchangé.",
    },
    delete: {
      subject: "Confirmez la suppression de votre compte",
      intro:
        "Vous avez demandé la suppression de votre compte AI Image Variations. Vos annonces et vos photos seront effacées définitivement. Pour confirmer, ouvrez ce lien dans le même navigateur ou la même application :",
      action: "Supprimer mon compte",
      outro: "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail et changez votre mot de passe : votre compte reste intact.",
    },
  },
};

/** Picks the first supported language of an `Accept-Language` header; English otherwise. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function accountEmail(kind: AccountEmail, locale: Locale, to: string, url: string): MailMessage {
  const c = COPY[locale][kind];
  return {
    to,
    subject: c.subject,
    text: `${c.intro}\n\n${url}\n\n${c.outro}\n`,
    html: `<p>${escapeHtml(c.intro)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(c.action)}</a></p><p>${escapeHtml(c.outro)}</p>`,
  };
}
