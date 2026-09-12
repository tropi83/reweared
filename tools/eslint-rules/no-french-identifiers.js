/**
 * Forbids French identifiers.
 *
 * The project convention wants English identifiers and French prose (comments, user-facing labels go
 * through i18n). A rule beats an intention: it runs in the editor, before commit and in CI.
 *
 * Detection compares **roots** against the words of the identifier split on camelCase / snake_case —
 * never a substring match: `iconPath` must not trip on "icon" and `stepEnd` must not trip on "step".
 * A word matches when it equals a root, or a root followed by a common French ending (plural,
 * feminine, conjugation).
 *
 * Comments and strings are never visited: ESLint only hands us AST identifier nodes.
 */

/**
 * French roots. An entry must be neither a common English word nor the prefix of one — `mode`,
 * `type`, `total`, `label`, `format`, `image`, `distance`, `action`, `position`, `photo`, `model`,
 * `mannequin`, `brand` exist in both languages and have no place here — and `categorie` + "s" would be
 * the English "categories".
 */
const ROOTS = [
  "ajout",
  "anneau",
  "annonce",
  "annul",
  "aucun",
  "avanc",
  "bouton",
  "chargement",
  "chemin",
  "cible",
  "compte",
  "conteneur",
  "couleur",
  "creer",
  "debut",
  "dessin",
  "donnee",
  "dossier",
  "duree",
  "ecart",
  "ecran",
  "effet",
  "enfant",
  "entree",
  "envoi",
  "envoy",
  "epuis",
  "erreur",
  "etape",
  "fenetre",
  "fichier",
  "generer",
  "gisement",
  "hauteur",
  "icone",
  "joueur",
  "largeur",
  "lecture",
  "libelle",
  "lister",
  "marchand",
  "marque",
  "modele",
  "niveau",
  "nombre",
  "obtenir",
  "palier",
  "panneau",
  "poser",
  "prix",
  "prochain",
  "projet",
  "publier",
  "quete",
  "recolte",
  "recompense",
  "reglage",
  "ressource",
  "retour",
  "seuil",
  "signaler",
  "suivant",
  "taille",
  "texte",
  "titre",
  "utilisateur",
  "valeur",
  "vendeur",
  "vendre",
  "vignette",
  "vitesse",
];

/** French word endings tolerated after a root. */
const ENDINGS = ["", "s", "e", "es", "er", "ee", "ees", "ent", "eur", "euse", "ant", "able"];

const FRENCH_WORDS = new Set(ROOTS.flatMap((root) => ENDINGS.map((ending) => root + ending)));

/** Splits an identifier into words: camelCase, PascalCase, SCREAMING_SNAKE. */
function splitWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function frenchWord(name) {
  for (const word of splitWords(name)) {
    if (FRENCH_WORDS.has(word)) return word;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Identifiers are written in English; French is reserved for comments and user-facing labels.",
    },
    schema: [],
    messages: {
      french: "“{{name}}” is a French identifier (“{{word}}”). The convention wants English here — French stays in comments and i18n labels.",
    },
  },

  create(context) {
    /** A name can appear many times; it is reported once, where it is declared. */
    const report = (node, name) => {
      const word = frenchWord(name);
      if (word !== null) context.report({ node, messageId: "french", data: { name, word } });
    };
    const nameOf = (node) => (node && node.type === "Identifier" ? node.name : null);
    const declared = (node) => {
      const name = nameOf(node.id);
      if (name) report(node.id, name);
    };
    const member = (node) => {
      const name = nameOf(node.key);
      if (name && !node.computed) report(node.key, name);
    };

    return {
      VariableDeclarator: declared,
      FunctionDeclaration: declared,
      ClassDeclaration: declared,
      TSInterfaceDeclaration: declared,
      TSTypeAliasDeclaration: declared,
      TSEnumDeclaration: declared,
      PropertyDefinition: member,
      MethodDefinition: member,
    };
  },
};
