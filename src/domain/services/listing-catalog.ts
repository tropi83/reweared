import type { ListingCategory, ListingCategoryId, ListingSelection, ListingSubcategory, Localized, Mannequin, ProductKind, ShotSpec } from "@/domain/models";
import { describeWearer, mannequinApplies, posePhrase } from "./mannequin";

/**
 * Listing catalogue: the marketplace taxonomy (10 categories, 56 subcategories) and, per
 * ProductKind, the plan of photos generated for a listing (four base shots, plus a mirror selfie for
 * wearable kinds outside the kids category).
 *
 * Every prompt starts with the same fidelity preamble so the AI keeps the *actual* item (shape,
 * colours, pattern, logos, text) and only changes presentation. Prompts are English because the
 * image models are trained on English; labels are localized for the UI.
 */

const L = (en: string, fr: string): Localized => ({ en, fr });

interface ShotTemplate {
  id: string;
  label: Localized;
  /** May use {{subject}}, {{wearer}} and {{pose|default}}. */
  template: string;
  /** Categories for which this shot is skipped (a mirror selfie makes no sense for kids' items). */
  excludeCategories?: ListingCategoryId[];
}

/** Fidelity rules shared by every shot. */
const PREAMBLE =
  "Product photo of the exact same {{subject}} shown in the reference image. Keep its shape, proportions, colors, pattern, material, logos and any visible text identical; do not add or remove elements.";
const QUALITY = "Sharp focus, realistic, high-resolution marketplace listing photo, no watermark, no added text.";

function shot(id: string, label: Localized, body: string): ShotTemplate {
  return { id, label, template: `${PREAMBLE} ${body} ${QUALITY}` };
}

const RETOUCH = (extra: string) =>
  shot(
    "retouch",
    L("Retouched", "Retouchée"),
    `Same composition and background as the reference, cleaned up and enhanced: ${extra} Accurate colors, balanced exposure, subtle professional retouching only.`,
  );
const STUDIO = (extra: string) =>
  shot(
    "studio",
    L("Studio background", "Fond studio"),
    `${extra} Clean seamless light-gray studio background, soft even lighting, gentle contact shadow, e-commerce catalog style, item centered and fully visible.`,
  );
const CONTEXT = (id: string, label: Localized, extra: string) => shot(id, label, extra);
const DETAIL = (id: string, label: Localized, extra: string) => shot(id, label, extra);
/** Mirror selfie — the most common second-hand marketplace photo. Skipped for kids' items. */
const SELFIE = (extra: string): ShotTemplate => ({
  ...shot(
    "selfie",
    L("Mirror selfie", "Selfie miroir"),
    `Casual mirror selfie taken by {{wearer}} with a smartphone in front of a full-length mirror at home, ${extra} the phone partially hides the face, natural indoor light, slightly candid framing, item fully visible and unchanged.`,
  ),
  excludeCategories: ["kids"],
});

const PLANS: Record<ProductKind, ShotTemplate[]> = {
  garment: [
    RETOUCH("the garment neatly ironed with no wrinkles or creases, lint removed."),
    STUDIO("The garment freshly ironed and wrinkle-free, laid flat and neatly arranged, or on an invisible mannequin, showing its full silhouette."),
    CONTEXT(
      "worn",
      L("Worn", "Portée"),
      "The garment worn by {{wearer}}, {{pose|standing naturally}}, neutral studio background, fashion catalog photo, garment fully visible and unchanged.",
    ),
    SELFIE("wearing the garment as part of a simple everyday outfit,"),
    DETAIL(
      "folded",
      L("Folded", "Pliée"),
      "The garment freshly ironed — no wrinkles, creases or folds marks, crisp smooth fabric — then neatly folded on a plain white surface, top-down flat lay, soft daylight, brand label or neckline visible if present.",
    ),
  ],
  footwear: [
    RETOUCH("the shoes cleaned, laces neat, scuffs and dust removed while keeping honest wear visible."),
    STUDIO("The pair side by side at a three-quarter angle, both shoes fully visible."),
    CONTEXT(
      "worn",
      L("Worn", "Portées"),
      "The shoes worn by {{wearer}}, {{pose|standing}}, cropped at the ankles or knees, on a neutral floor, natural light.",
    ),
    SELFIE("wearing the shoes with a simple everyday outfit, full body visible down to the shoes,"),
    DETAIL(
      "profile",
      L("Side profile", "Profil"),
      "A single shoe in strict side profile on a white surface, sole and heel shape clearly visible, close framing.",
    ),
  ],
  bag: [
    RETOUCH("the bag cleaned and its shape restored, straps arranged neatly."),
    STUDIO("The bag standing upright on a white plinth, handles up, front facing the camera."),
    CONTEXT("carried", L("Carried", "Portée"), "The bag carried on the shoulder or in the hand of {{wearer}}, neutral studio background, waist-level framing."),
    SELFIE("holding or wearing the bag,"),
    DETAIL(
      "interior",
      L("Open / interior", "Ouvert / intérieur"),
      "The bag opened to show its interior and lining, top-down or three-quarter close-up on a white surface.",
    ),
  ],
  accessory: [
    RETOUCH("the accessory cleaned, straightened and free of lint or dust."),
    STUDIO("The accessory arranged as a top-down flat lay, centered."),
    CONTEXT(
      "worn",
      L("Worn", "Porté"),
      "The accessory worn by {{wearer}}, tight portrait framing focused on the item, face partially out of frame, neutral background.",
    ),
    SELFIE("wearing the accessory,"),
    DETAIL(
      "detail",
      L("Material close-up", "Gros plan matière"),
      "Macro close-up of the material, texture and any hardware, buckle or clasp on a white surface.",
    ),
  ],
  jewelry: [
    RETOUCH("the piece polished and sparkling, tarnish removed, stones bright."),
    STUDIO("The piece on a dark velvet or white marble surface, macro lens, soft reflections."),
    CONTEXT(
      "worn",
      L("Worn", "Porté"),
      "The piece worn by {{wearer}} — on the neck, wrist, ear or hand as appropriate — tight close-up on skin, neutral background.",
    ),
    SELFIE("wearing the piece, framed so the jewelry is clearly visible,"),
    DETAIL("box", L("With box", "Avec écrin"), "The piece presented in an open jewelry box or on a white ring tray, top-down close-up."),
  ],
  watch: [
    RETOUCH("the case and strap cleaned, crystal free of smudges, dial clearly readable."),
    STUDIO("The watch angled at forty-five degrees on a white surface, strap forming an open loop."),
    CONTEXT("wrist", L("On the wrist", "Au poignet"), "The watch worn on the wrist of {{wearer}}, close-up, neutral background, dial facing the camera."),
    SELFIE("wearing the watch with the wrist raised toward the mirror so the dial is visible,"),
    DETAIL("dial", L("Dial close-up", "Gros plan cadran"), "Macro close-up of the dial, hands and case finishing, sharp and evenly lit."),
  ],
  beauty: [
    RETOUCH("the packaging clean, label crisp and readable, fill level unchanged."),
    STUDIO("The product standing on a white marble surface with a soft shadow, front label facing the camera."),
    CONTEXT(
      "shelf",
      L("Bathroom shelf", "Salle de bain"),
      "The product on a tidy bathroom shelf with a plant and a folded towel, natural light, lifestyle photo.",
    ),
    DETAIL(
      "texture",
      L("Texture / detail", "Texture / détail"),
      "Close-up of the product with its cap open showing the texture or applicator, white background.",
    ),
  ],
  toy: [
    RETOUCH("the toy cleaned, colors bright, small marks reduced while keeping it honest."),
    STUDIO("The toy centered on a white background, front three-quarter view."),
    CONTEXT("play", L("Play scene", "En jeu"), "The toy on a wooden floor in a bright playroom, arranged as if mid-play, no people visible."),
    DETAIL("set", L("Full set", "Ensemble complet"), "All pieces or accessories of the toy laid out neatly in a top-down flat lay on a white surface."),
  ],
  childcare: [
    RETOUCH("the item cleaned, fabric smooth, straps and buckles neat."),
    STUDIO("The item fully assembled, side three-quarter view, centered."),
    CONTEXT("nursery", L("In the nursery", "En chambre"), "The item in a bright, tidy nursery with soft daylight, no people visible."),
    DETAIL(
      "folded",
      L("Folded / compact", "Plié / compact"),
      "The item folded or in its compact configuration next to its accessories, top-down on a white surface.",
    ),
  ],
  stationery: [
    RETOUCH("the item clean, edges straight, colors accurate."),
    STUDIO("Top-down flat lay of the item, centered."),
    CONTEXT("desk", L("On a desk", "Sur un bureau"), "The item on a tidy wooden desk with a notebook and a pen, natural light, lifestyle photo."),
    DETAIL("detail", L("Close-up", "Gros plan"), "Macro close-up of the item's surface, print or mechanism on a white background."),
  ],
  decor: [
    RETOUCH("the object dusted and cleaned, colors accurate, reflections controlled."),
    STUDIO("The object centered on a white surface, front three-quarter view."),
    CONTEXT("room", L("Styled in a room", "Mis en scène"), "The object styled on a shelf or side table in a bright modern living room, soft daylight."),
    DETAIL("detail", L("Material close-up", "Gros plan matière"), "Macro close-up of the object's material, finish and any maker's mark."),
  ],
  "home-textile": [
    RETOUCH("the textile ironed and smooth, colors accurate, lint removed."),
    STUDIO("The textile freshly ironed, smooth and wrinkle-free, neatly folded in a stack, front view, centered."),
    CONTEXT("styled", L("Styled at home", "Mis en scène"), "The textile in use on a made bed or sofa in a bright bedroom or living room, soft daylight."),
    DETAIL("texture", L("Texture close-up", "Gros plan texture"), "Macro close-up of the weave, pattern and hem stitching."),
  ],
  kitchenware: [
    RETOUCH("the item spotless and polished, no fingerprints or water marks."),
    STUDIO("The item centered on a white surface, front three-quarter view."),
    CONTEXT(
      "kitchen",
      L("On the counter", "En cuisine"),
      "The item on a clean kitchen counter with a cutting board and fresh ingredients nearby, natural light.",
    ),
    DETAIL("detail", L("Detail", "Détail"), "Close-up of the handle, lid or finish and any brand marking, white background."),
  ],
  tableware: [
    RETOUCH("the pieces spotless, glaze and pattern crisp, no chips exaggerated."),
    STUDIO("The set neatly arranged and stacked on a white surface, soft shadow."),
    CONTEXT("table", L("Table setting", "Table dressée"), "The pieces used in an elegant table setting with linen napkins and cutlery, soft daylight."),
    DETAIL("detail", L("Pattern close-up", "Gros plan motif"), "Macro close-up of the pattern, rim and maker's mark on the underside."),
  ],
  storage: [
    RETOUCH("the item clean, lines straight, colors accurate."),
    STUDIO("The item centered on a white background, front three-quarter view, empty."),
    CONTEXT("room", L("In use at home", "En situation"), "The item in a tidy room holding neatly organized everyday objects, soft daylight."),
    DETAIL("open", L("Open / inside", "Ouvert / intérieur"), "The item open showing its interior compartments, close-up."),
  ],
  furniture: [
    RETOUCH("the piece dusted and cleaned, colors accurate, straight verticals."),
    STUDIO("The piece on a white cyclorama background, front three-quarter view, fully visible."),
    CONTEXT("interior", L("Styled interior", "Intérieur"), "The piece styled in a bright modern interior with a rug and a plant, natural daylight."),
    DETAIL("detail", L("Material close-up", "Gros plan matière"), "Macro close-up of the material, joinery, hardware or upholstery."),
  ],
  phone: [
    RETOUCH("the screen clean and reflection-free, body spotless, screen content unchanged."),
    STUDIO("The phone standing at a slight angle on a white surface, screen facing the camera."),
    CONTEXT("hand", L("In hand", "En main"), "The phone held in the hand of {{wearer}}, screen on, neutral background, close framing."),
    DETAIL("back", L("Back / camera", "Dos / caméra"), "The back of the phone showing its camera module and finish, macro close-up on a white surface."),
  ],
  computer: [
    RETOUCH("the screen and keyboard clean, no fingerprints or dust."),
    STUDIO("The device open at a comfortable angle on a white surface, screen facing the camera."),
    CONTEXT("desk", L("Workspace", "Bureau"), "The device on a tidy desk with a mug and a notebook, natural light, lifestyle photo."),
    DETAIL("ports", L("Ports / keyboard", "Ports / clavier"), "Close-up of the ports, keyboard or trackpad, sharp and evenly lit."),
  ],
  audio: [
    RETOUCH("the item clean, pads and cables neat."),
    STUDIO("The item centered on a white surface, three-quarter view."),
    CONTEXT("use", L("In use", "En usage"), "The item in use — worn by {{wearer}} or placed on a shelf in a living room — neutral, natural light."),
    DETAIL("detail", L("Detail", "Détail"), "Close-up of the controls, connectors or ear pads."),
  ],
  camera: [
    RETOUCH("the body and lens spotless, glass free of dust."),
    STUDIO("The camera angled at forty-five degrees on a white surface, lens cap off."),
    CONTEXT("hands", L("In hands", "En main"), "The camera held in the hands of {{wearer}} ready to shoot, neutral background."),
    DETAIL("lens", L("Lens / dials", "Objectif / molettes"), "Macro close-up of the lens front element and the top dials."),
  ],
  gaming: [
    RETOUCH("the item clean, buttons and sticks neat, no dust."),
    STUDIO("The item centered on a white surface, front view."),
    CONTEXT("setup", L("Gaming setup", "Setup gaming"), "The item on a desk next to a monitor in a cozy gaming setup with soft ambient light."),
    DETAIL("detail", L("Close-up", "Gros plan"), "Close-up of the controls, ports or finish."),
  ],
  "smart-device": [
    RETOUCH("the device clean, screen or indicator visible."),
    STUDIO("The device centered on a white surface, front three-quarter view."),
    CONTEXT("home", L("At home", "À la maison"), "The device installed or placed in a modern home setting, natural light."),
    DETAIL("detail", L("Detail", "Détail"), "Close-up of the device's controls, sensors or connectors."),
  ],
  book: [
    RETOUCH("the cover flat and crisp, colors accurate, glare removed."),
    STUDIO("The book standing slightly angled on a white surface, cover facing the camera."),
    CONTEXT("table", L("Reading nook", "Coin lecture"), "The book on a wooden table next to a cup of coffee and reading glasses, warm natural light."),
    DETAIL("spine", L("Spine & pages", "Tranche & pages"), "The book at an angle showing its spine and page edges, close-up, condition clearly visible."),
  ],
  "board-game": [
    RETOUCH("the box crisp, corners tidy, colors accurate."),
    STUDIO("The box front-facing on a white surface, slightly angled."),
    CONTEXT("table", L("Game night", "Soirée jeu"), "The game set up on a wooden table with its components ready to play, warm light, no people."),
    DETAIL("components", L("Components", "Contenu"), "All components laid out neatly next to the open box, top-down flat lay."),
  ],
  "video-game": [
    RETOUCH("the case clean, cover art crisp and glare-free."),
    STUDIO("The case standing on a white surface, cover facing the camera."),
    CONTEXT("shelf", L("On the shelf", "Sur l'étagère"), "The case on a shelf next to a console and controller in a cozy setup."),
    DETAIL("inside", L("Open case", "Boîtier ouvert"), "The case open showing the disc or cartridge and any manual, close-up."),
  ],
  disc: [
    RETOUCH("the case clean, artwork crisp, scratches on the case reduced."),
    STUDIO("The case front-facing on a white surface, slightly angled."),
    CONTEXT("shelf", L("On the shelf", "Sur l'étagère"), "The case on a media shelf among other albums, warm light."),
    DETAIL("open", L("Open case", "Boîtier ouvert"), "The case open showing the disc and booklet, close-up."),
  ],
  vinyl: [
    RETOUCH("the sleeve flat and clean, artwork crisp, ring wear softened but honest."),
    STUDIO("The sleeve front-facing on a white surface with the record peeking out."),
    CONTEXT("turntable", L("On a turntable", "Sur platine"), "The record on a turntable with the sleeve propped behind it, warm living-room light."),
    DETAIL("record", L("Record close-up", "Gros plan disque"), "The record out of its sleeve, close-up of the label and grooves."),
  ],
  "trading-card": [
    RETOUCH("the card flat, glare-free, colors accurate, edges and corners shown honestly."),
    STUDIO("The card centered on a black or white surface, perfectly straight, top-down."),
    CONTEXT("sleeve", L("In a sleeve", "Sous protection"), "The card in a clear sleeve and toploader at a slight angle, dark background."),
    DETAIL("corners", L("Corners & edges", "Coins & bords"), "Macro close-up of the card's corners and edges to show condition, even lighting."),
  ],
  figurine: [
    RETOUCH("the figurine dusted, paint colors accurate, base clean."),
    STUDIO("The figurine centered on a white surface, front three-quarter view, full height."),
    CONTEXT("display", L("Display shelf", "Vitrine"), "The figurine on a lit display shelf with a subtle blurred backdrop."),
    DETAIL("face", L("Detail close-up", "Gros plan détail"), "Macro close-up of the face, paint and sculpt details."),
  ],
  collectible: [
    RETOUCH("the item cleaned gently, patina and markings preserved."),
    STUDIO("The item centered on a white surface, front three-quarter view."),
    CONTEXT("styled", L("Styled", "Mis en scène"), "The item styled on a wooden surface with a subtle vintage backdrop, warm light."),
    DETAIL("marks", L("Markings close-up", "Gros plan marquages"), "Macro close-up of markings, signatures, stamps or serial numbers."),
  ],
  instrument: [
    RETOUCH("the instrument polished, strings or keys clean, finish accurate."),
    STUDIO("The instrument front-facing on a white background, full length."),
    CONTEXT("played", L("Being played", "En jeu"), "The instrument played by {{wearer}}, hands visible, neutral studio background."),
    DETAIL("detail", L("Detail", "Détail"), "Macro close-up of the instrument's key details: headstock, keys, valves or finish."),
  ],
  "sport-gear": [
    RETOUCH("the gear clean, colors vivid, straps and laces neat."),
    STUDIO("The gear centered on a white surface, three-quarter view."),
    CONTEXT("action", L("In action", "En action"), "The gear in use by {{wearer}} in a gym or outdoor setting, dynamic but sharp, gear fully visible."),
    DETAIL("detail", L("Detail", "Détail"), "Close-up of the material, grip or size marking."),
  ],
  outdoor: [
    RETOUCH("the gear clean and dry, colors accurate, straps neat."),
    STUDIO("The gear set up or standing on a white background, three-quarter view."),
    CONTEXT("nature", L("Outdoors", "En extérieur"), "The gear in use in a mountain or forest setting at golden hour, no people or a distant silhouette."),
    DETAIL("detail", L("Detail", "Détail"), "Close-up of zippers, buckles, seams or fabric."),
  ],
  bike: [
    RETOUCH("the bike clean, tires and chain free of dirt, paint accurate."),
    STUDIO("The bike in strict side profile on a white background, drive side visible."),
    CONTEXT("ride", L("Outdoor", "En extérieur"), "The bike leaning against a wall on a quiet street or trail, natural light, no people."),
    DETAIL("drivetrain", L("Drivetrain", "Transmission"), "Close-up of the drivetrain, brakes and frame details."),
  ],
  "pet-clothing": [
    RETOUCH("the garment clean, fur removed, colors accurate."),
    STUDIO("The garment laid flat top-down on a white surface."),
    CONTEXT("worn", L("Worn by a pet", "Porté"), "The garment worn by a friendly dog or cat sitting calmly, neutral studio background."),
    DETAIL("detail", L("Detail", "Détail"), "Close-up of the fastening, size label and fabric."),
  ],
  "pet-toy": [
    RETOUCH("the toy clean, colors bright."),
    STUDIO("The toy centered on a white background."),
    CONTEXT("play", L("Play scene", "En jeu"), "The toy with a playful dog or cat next to it on a living-room rug, natural light."),
    DETAIL("detail", L("Detail", "Détail"), "Close-up of the material and stitching."),
  ],
  "pet-accessory": [
    RETOUCH("the item clean, straps flat, hardware shiny."),
    STUDIO("The item arranged as a top-down flat lay on a white surface."),
    CONTEXT("worn", L("On a pet", "Sur l'animal"), "The item worn by a calm dog or cat, close framing, neutral background."),
    DETAIL("hardware", L("Buckle / hardware", "Boucle / attache"), "Macro close-up of the buckle, clip or adjustment hardware."),
  ],
  "pet-bedding": [
    RETOUCH("the bedding clean, fabric smooth, fur removed."),
    STUDIO("The bedding centered on a white surface, front three-quarter view."),
    CONTEXT("home", L("At home", "À la maison"), "The bedding in a living room with a dog or cat resting in it, soft daylight."),
    DETAIL("texture", L("Texture", "Texture"), "Close-up of the fabric, cushion and seams."),
  ],
  "pet-carrier": [
    RETOUCH("the carrier clean, mesh and zippers neat."),
    STUDIO("The carrier centered on a white surface, front three-quarter view, door closed."),
    CONTEXT("use", L("In use", "En usage"), "The carrier with a calm cat or small dog visible inside, placed on a floor at home."),
    DETAIL("open", L("Open", "Ouvert"), "The carrier with its door or top open showing the interior, close-up."),
  ],
  "leather-goods": [
    RETOUCH("the leather clean and conditioned, edges neat, hardware polished."),
    STUDIO("The item on a white surface, front three-quarter view."),
    CONTEXT("use", L("In use", "En usage"), "The item held or worn by {{wearer}}, close framing, neutral background."),
    SELFIE("wearing or holding the leather item so it is clearly visible,"),
    DETAIL("grain", L("Leather close-up", "Gros plan cuir"), "Macro close-up of the leather grain, stitching and embossed logo."),
  ],
};

const sub = (id: string, label: Localized, kind: ProductKind, subject: string): ListingSubcategory => ({ id, label, kind, subject });

export const LISTING_CATEGORIES: ListingCategory[] = [
  {
    id: "women",
    label: L("Women", "Femme"),
    wearer: "a woman",
    subcategories: [
      sub("clothing", L("Clothing", "Vêtements"), "garment", "women's garment"),
      sub("shoes", L("Shoes", "Chaussures"), "footwear", "pair of women's shoes"),
      sub("bags", L("Bags", "Sacs"), "bag", "women's bag"),
      sub("accessories", L("Accessories", "Accessoires"), "accessory", "women's fashion accessory"),
      sub("beauty", L("Beauty", "Beauté"), "beauty", "beauty product"),
    ],
  },
  {
    id: "men",
    label: L("Men", "Homme"),
    wearer: "a man",
    subcategories: [
      sub("clothing", L("Clothing", "Vêtements"), "garment", "men's garment"),
      sub("shoes", L("Shoes", "Chaussures"), "footwear", "pair of men's shoes"),
      sub("accessories", L("Accessories", "Accessoires"), "accessory", "men's fashion accessory"),
      sub("grooming", L("Grooming", "Soins"), "beauty", "men's grooming product"),
    ],
  },
  {
    id: "kids",
    label: L("Kids & baby", "Enfants / Bébé"),
    wearer: "a child, face not visible",
    subcategories: [
      sub("clothing", L("Clothing", "Vêtements"), "garment", "children's garment"),
      sub("shoes", L("Shoes", "Chaussures"), "footwear", "pair of children's shoes"),
      sub("toys", L("Toys", "Jouets"), "toy", "toy"),
      sub("childcare", L("Childcare", "Puériculture"), "childcare", "baby care item"),
      sub("school", L("School", "Scolaire"), "stationery", "school supply"),
    ],
  },
  {
    id: "home",
    label: L("Home", "Maison"),
    wearer: "a person",
    subcategories: [
      sub("decoration", L("Decoration", "Décoration"), "decor", "decorative object"),
      sub("textile", L("Textile", "Textile"), "home-textile", "home textile"),
      sub("kitchen", L("Kitchen", "Cuisine"), "kitchenware", "kitchen item"),
      sub("tableware", L("Tableware", "Vaisselle"), "tableware", "tableware"),
      sub("storage", L("Storage", "Rangement"), "storage", "storage item"),
      sub("furniture", L("Furniture", "Mobilier"), "furniture", "piece of furniture"),
    ],
  },
  {
    id: "electronics",
    label: L("Electronics", "Électronique"),
    wearer: "a person",
    subcategories: [
      sub("phones", L("Phones", "Téléphones"), "phone", "smartphone"),
      sub("computers", L("Computers", "Informatique"), "computer", "computer or tablet"),
      sub("audio", L("Audio", "Audio"), "audio", "audio device"),
      sub("photo", L("Photo", "Photo"), "camera", "camera"),
      sub("gaming", L("Gaming", "Gaming"), "gaming", "gaming device"),
      sub("smart", L("Smart devices", "Objets connectés"), "smart-device", "smart device"),
    ],
  },
  {
    id: "entertainment",
    label: L("Entertainment", "Divertissement"),
    wearer: "a person",
    subcategories: [
      sub("books", L("Books", "Livres"), "book", "book"),
      sub("games", L("Games", "Jeux"), "board-game", "board game"),
      sub("video-games", L("Video games", "Jeux vidéo"), "video-game", "video game"),
      sub("cds", L("CDs", "CD"), "disc", "CD album"),
      sub("vinyl", L("Vinyl", "Vinyles"), "vinyl", "vinyl record"),
      sub("dvds", L("DVDs", "DVD"), "disc", "DVD or Blu-ray"),
    ],
  },
  {
    id: "hobbies",
    label: L("Hobbies & collectibles", "Loisirs & collections"),
    wearer: "a person",
    subcategories: [
      sub("cards", L("Cards", "Cartes"), "trading-card", "trading card"),
      sub("figurines", L("Figurines", "Figurines"), "figurine", "figurine"),
      sub("vintage", L("Vintage", "Vintage"), "collectible", "vintage object"),
      sub("collections", L("Collections", "Collections"), "collectible", "collectible item"),
      sub("stationery", L("Stationery", "Papeterie"), "stationery", "stationery item"),
      sub("instruments", L("Instruments", "Instruments"), "instrument", "musical instrument"),
    ],
  },
  {
    id: "sport",
    label: L("Sport", "Sport"),
    wearer: "an athlete",
    subcategories: [
      sub("clothing", L("Clothing", "Vêtements"), "garment", "sportswear garment"),
      sub("shoes", L("Shoes", "Chaussures"), "footwear", "pair of sports shoes"),
      sub("football", L("Football", "Football"), "sport-gear", "football equipment"),
      sub("fitness", L("Fitness", "Fitness"), "sport-gear", "fitness equipment"),
      sub("outdoor", L("Outdoor", "Outdoor"), "outdoor", "outdoor gear"),
      sub("cycling", L("Cycling", "Cyclisme"), "bike", "bicycle or cycling gear"),
    ],
  },
  {
    id: "pets",
    label: L("Pets", "Animaux"),
    wearer: "a pet",
    subcategories: [
      sub("clothing", L("Clothing", "Vêtements"), "pet-clothing", "pet garment"),
      sub("toys", L("Toys", "Jouets"), "pet-toy", "pet toy"),
      sub("collars", L("Collars", "Colliers"), "pet-accessory", "pet collar"),
      sub("leashes", L("Leashes", "Laisses"), "pet-accessory", "pet leash"),
      sub("bedding", L("Bedding", "Couchages"), "pet-bedding", "pet bed"),
      sub("carriers", L("Carriers", "Transport"), "pet-carrier", "pet carrier"),
    ],
  },
  {
    id: "luxury",
    label: L("Designer & luxury", "Créateurs / luxe"),
    wearer: "an elegant model",
    subcategories: [
      sub("fashion", L("Fashion", "Mode"), "garment", "designer garment"),
      sub("bags", L("Bags", "Sacs"), "bag", "designer handbag"),
      sub("shoes", L("Shoes", "Chaussures"), "footwear", "pair of designer shoes"),
      sub("jewelry", L("Jewelry", "Bijoux"), "jewelry", "piece of fine jewelry"),
      sub("watches", L("Watches", "Montres"), "watch", "luxury watch"),
      sub("leather", L("Leather goods", "Maroquinerie"), "leather-goods", "leather good"),
    ],
  },
];

export function findCategory(id: string): ListingCategory | undefined {
  return LISTING_CATEGORIES.find((c) => c.id === id);
}

export function findSubcategory(selection: ListingSelection): { category: ListingCategory; subcategory: ListingSubcategory } | undefined {
  const category = findCategory(selection.categoryId);
  const subcategory = category?.subcategories.find((s) => s.id === selection.subcategoryId);
  return category && subcategory ? { category, subcategory } : undefined;
}

const POSE_SLOT = /\{\{\s*pose\s*(?:\|([^}]*))?\}\}/g;
const WEARER = /\{\{\s*wearer\s*\}\}/;

/**
 * `{{pose|default}}` renders `vars.pose` or its default. When a pose is given and the template has a
 * person but no pose slot, the pose is appended as its own sentence — a prompt never gets two poses.
 */
export function interpolateShot(template: string, vars: { subject: string; wearer: string; pose?: string }): string {
  const hasSlot = /\{\{\s*pose/.test(template);
  let out = template.replace(POSE_SLOT, (_match, fallback: string | undefined) => vars.pose ?? (fallback ?? "").trim());
  out = out.replace(/\{\{\s*subject\s*\}\}/g, vars.subject).replace(/\{\{\s*wearer\s*\}\}/g, vars.wearer);
  if (vars.pose && !hasSlot && WEARER.test(template)) out = `${out} The person is ${vars.pose}.`;
  return out;
}

/** The prompts of a listing pack, fully interpolated; `mannequin` replaces the generic person where it applies. */
export function buildListingShots(selection: ListingSelection, options: { mannequin?: Mannequin } = {}): ShotSpec[] {
  const found = findSubcategory(selection);
  if (!found) throw new Error(`Unknown listing selection ${selection.categoryId}/${selection.subcategoryId}`);
  const { category, subcategory } = found;
  const m = options.mannequin && mannequinApplies(category.id) ? options.mannequin : undefined;
  const wearer = m ? describeWearer(category.wearer, m) : category.wearer;
  const pose = m ? posePhrase(m.pose) : undefined;
  return PLANS[subcategory.kind]
    .filter((s) => !s.excludeCategories?.includes(category.id))
    .map((s) => ({
      id: s.id,
      label: s.label,
      prompt: interpolateShot(s.template, { subject: subcategory.subject, wearer, ...(pose && WEARER.test(s.template) ? { pose } : {}) }),
    }));
}

/** Stable id for the built-in recipe of a subcategory. */
export function listingRecipeId(selection: ListingSelection): string {
  return `rcp_listing_${selection.categoryId}_${selection.subcategoryId.replace(/-/g, "")}`;
}

export function listingSelectionFromRecipeId(id: string): ListingSelection | undefined {
  const m = /^rcp_listing_([a-z]+)_([a-z0-9]+)$/.exec(id);
  if (!m) return undefined;
  const categoryId = m[1] as ListingCategoryId;
  const category = findCategory(categoryId);
  const subcategory = category?.subcategories.find((s) => s.id.replace(/-/g, "") === m[2]);
  return category && subcategory ? { categoryId, subcategoryId: subcategory.id } : undefined;
}

export const PRODUCT_KINDS = Object.keys(PLANS) as ProductKind[];
