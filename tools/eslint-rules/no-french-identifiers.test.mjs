/**
 * The rule flags French words in declared identifiers (whole words of the split name, never substrings),
 * and leaves strings, comments and English-looking names alone.
 */
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

// RuleTester drives vitest's describe/it itself.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
import rule from "./no-french-identifiers.js";

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: "module" } });

describe("no-french-identifiers", () => {
  tester.run("accepts English identifiers, including words that merely start like a French root", rule, {
    valid: [
      "const iconPath = 1;",
      "const stepEnd = 1;",
      "function loadListing() {}",
      "const mannequin = {}; const photo = 1; const model = 1; const total = 0;",
      "const label = t('bouton.creer'); // 'annonce' in a comment is fine",
      "class Store { listingId = ''; }",
      "type CategoryId = string; interface ListingDocument { images: unknown }",
    ],
    invalid: [],
  });

  tester.run("flags French words wherever a name is declared", rule, {
    valid: [],
    invalid: [
      { code: "const nombreDePhotos = 5;", errors: [{ messageId: "french", data: { name: "nombreDePhotos", word: "nombre" } }] },
      { code: "function creerAnnonce() {}", errors: [{ messageId: "french" }] },
      { code: "class Annonce {}", errors: [{ messageId: "french", data: { name: "Annonce", word: "annonce" } }] },
      { code: "interface ReglageUtilisateur {}", errors: [{ messageId: "french" }] },
      { code: "type Modele = string;", errors: [{ messageId: "french" }] },
      { code: "enum Etapes { A }", errors: [{ messageId: "french" }] },
      { code: "class X { valeurs = []; obtenirTitre() {} }", errors: [{ messageId: "french" }, { messageId: "french" }] },
      { code: "const PROJET_COURANT = 1;", errors: [{ messageId: "french", data: { name: "PROJET_COURANT", word: "projet" } }] },
    ],
  });
});
