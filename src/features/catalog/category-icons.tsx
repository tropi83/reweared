import {
  Archive,
  Armchair,
  Baby,
  Backpack,
  Bed,
  Bike,
  Blocks,
  Bone,
  BookOpen,
  Briefcase,
  Camera,
  Clapperboard,
  CookingPot,
  Crown,
  Dices,
  Disc,
  Disc3,
  Dumbbell,
  Film,
  Footprints,
  Gamepad2,
  Gem,
  Glasses,
  GraduationCap,
  Guitar,
  Headphones,
  Hourglass,
  House,
  Lamp,
  Laptop,
  Layers,
  LibraryBig,
  Link,
  Mars,
  Mountain,
  Package,
  PawPrint,
  PenTool,
  Puzzle,
  Scissors,
  Shapes,
  Shirt,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tag,
  UtensilsCrossed,
  Venus,
  Volleyball,
  Watch,
  Wifi,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { CategoryId, CategorySelection } from "@/domain/models";

/**
 * Icons of the marketplace taxonomy (UI only — the domain catalogue stays free of React). The test next
 * to this file fails when a category or subcategory has no entry, so a new pack cannot ship iconless.
 */
export const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  women: Venus,
  men: Mars,
  kids: Baby,
  home: House,
  electronics: Smartphone,
  entertainment: Clapperboard,
  hobbies: Puzzle,
  sport: Dumbbell,
  pets: PawPrint,
  luxury: Gem,
};

/** Keyed `<categoryId>/<subcategoryId>`: the same subcategory id can mean different things per category. */
export const SUBCATEGORY_ICONS: Record<string, LucideIcon> = {
  "women/clothing": Shirt,
  "women/shoes": Footprints,
  "women/bags": ShoppingBag,
  "women/accessories": Glasses,
  "women/beauty": Sparkles,
  "men/clothing": Shirt,
  "men/shoes": Footprints,
  "men/accessories": Watch,
  "men/grooming": Scissors,
  "kids/clothing": Shirt,
  "kids/shoes": Footprints,
  "kids/toys": Blocks,
  "kids/childcare": Baby,
  "kids/school": GraduationCap,
  "home/decoration": Lamp,
  "home/textile": Bed,
  "home/kitchen": CookingPot,
  "home/tableware": UtensilsCrossed,
  "home/storage": Archive,
  "home/furniture": Armchair,
  "electronics/phones": Smartphone,
  "electronics/computers": Laptop,
  "electronics/audio": Headphones,
  "electronics/photo": Camera,
  "electronics/gaming": Gamepad2,
  "electronics/smart": Wifi,
  "entertainment/books": BookOpen,
  "entertainment/games": Dices,
  "entertainment/video-games": Gamepad2,
  "entertainment/cds": Disc,
  "entertainment/vinyl": Disc3,
  "entertainment/dvds": Film,
  "hobbies/cards": Layers,
  "hobbies/figurines": Shapes,
  "hobbies/vintage": Hourglass,
  "hobbies/collections": LibraryBig,
  "hobbies/stationery": PenTool,
  "hobbies/instruments": Guitar,
  "sport/clothing": Shirt,
  "sport/shoes": Footprints,
  "sport/football": Volleyball,
  "sport/fitness": Dumbbell,
  "sport/outdoor": Mountain,
  "sport/cycling": Bike,
  "pets/clothing": Shirt,
  "pets/toys": Bone,
  "pets/collars": Tag,
  "pets/leashes": Link,
  "pets/bedding": Bed,
  "pets/carriers": Package,
  "luxury/fashion": Crown,
  "luxury/bags": Briefcase,
  "luxury/shoes": Footprints,
  "luxury/jewelry": Gem,
  "luxury/watches": Watch,
  "luxury/leather": Backpack,
};

export function categoryIcon(categoryId: CategoryId): LucideIcon {
  return CATEGORY_ICONS[categoryId];
}

/** The subcategory's icon, or its category's when the id is unknown (older data, custom recipes). */
export function subcategoryIcon(selection: CategorySelection): LucideIcon {
  return SUBCATEGORY_ICONS[`${selection.categoryId}/${selection.subcategoryId}`] ?? CATEGORY_ICONS[selection.categoryId];
}

/** Renders the icon of a selection (the map lookup happens here, so callers never build a component during render). */
export function CategoryIcon({ selection, ...props }: LucideProps & { selection: CategorySelection }) {
  const Icon = SUBCATEGORY_ICONS[`${selection.categoryId}/${selection.subcategoryId}`] ?? CATEGORY_ICONS[selection.categoryId];
  return <Icon {...props} />;
}
