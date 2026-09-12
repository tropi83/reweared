import type { CategorySelection } from "@/domain/models";
import { findSubcategory } from "@/domain/services/catalog";
import { useLocale } from "@/i18n";
import { CategoryIcon } from "./category-icons";

/** Small taxonomy icon shown next to a listing's name in lists; nothing when no category is chosen yet. */
export function CategoryBadge({ category }: { category: CategorySelection | undefined }) {
  const locale = useLocale();
  if (!category) return null;
  const found = findSubcategory(category);
  const title = found ? `${found.category.label[locale]} › ${found.subcategory.label[locale]}` : undefined;
  return <CategoryIcon selection={category} className="size-3.5 shrink-0 text-fg-muted" aria-label={title} role="img" />;
}
