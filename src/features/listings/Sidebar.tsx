import { BookOpen, Images, Plus, Settings, Sparkles } from "lucide-react";
import { useImageUrl } from "@/app/image-urls";
import { navigate, useRoute } from "@/app/router";
import { useListingsStore } from "@/app/stores/listings-store";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import type { ListingSummary } from "@/domain/models";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { useT } from "@/i18n";
import { CategoryBadge } from "../catalog/CategoryBadge";
import { ListingActionsMenu } from "./ListingActionsMenu";
import { cn } from "@/lib/cn";
import { importImageFile, pickImageFile } from "../workspace/useImageImport";

export function Sidebar() {
  const t = useT();
  const route = useRoute();
  const summaries = useListingsStore((s) => s.summaries);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm leading-tight font-semibold">{t("app.name")}</div>
          <div className="truncate text-[11px] text-fg-subtle">{t("about.local")}</div>
        </div>
      </div>

      <div className="px-3">
        <Button
          variant="primary"
          className="w-full"
          leftIcon={<Plus className="size-4" />}
          onClick={async () => {
            // Phones choose between the photo library and the camera on the home screen; desktop opens the file dialog.
            if (getPlatform().isMobile) {
              navigate({ name: "home" });
              useUiStore.getState().setSidebarOpen(false);
              return;
            }
            const file = await pickImageFile();
            if (file) await importImageFile(file);
          }}
        >
          {t("nav.newListing")}
        </Button>
      </div>

      <nav className="mt-3 px-3">
        <NavItem active={route.name === "home"} icon={<Images className="size-4" />} label={t("nav.listings")} onClick={() => navigate({ name: "home" })} />
        <NavItem
          active={route.name === "recipes"}
          icon={<BookOpen className="size-4" />}
          label={t("nav.recipes")}
          onClick={() => navigate({ name: "recipes" })}
        />
        <NavItem
          active={route.name === "settings"}
          icon={<Settings className="size-4" />}
          label={t("nav.settings")}
          onClick={() => navigate({ name: "settings" })}
        />
      </nav>

      <div className="mt-4 flex items-center justify-between px-4 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
        <span>{t("nav.recent")}</span>
        <span>{summaries.length}</span>
      </div>
      <ul className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {summaries.map((p) => (
          <ListingRow key={p.id} listing={p} active={route.name === "listing" && route.id === p.id} />
        ))}
        {summaries.length === 0 && <li className="px-2 py-6 text-center text-xs text-fg-subtle">{t("listings.empty.title")}</li>}
      </ul>
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
        active ? "bg-bg-elevated text-fg shadow-sm" : "text-fg-muted hover:bg-bg-elevated/60 hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ListingRow({ listing, active }: { listing: ListingSummary; active: boolean }) {
  const t = useT();
  const url = useImageUrl(listing.id, "thumbnail", listing.coverImageId);

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => navigate({ name: "listing", id: listing.id })}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg p-1.5 pr-9 text-left transition-colors",
          active ? "bg-bg-elevated shadow-sm" : "hover:bg-bg-elevated/60",
        )}
      >
        <div className="checkerboard size-11 shrink-0 overflow-hidden rounded-md bg-bg-sunken">
          {url && <img src={url} alt="" className="size-full object-cover" loading="lazy" decoding="async" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <CategoryBadge category={listing.category} />
            <span className="truncate">{listing.name}</span>
          </div>
          <div className="truncate text-[11px] text-fg-subtle">{t("listings.imageCount", { count: listing.imageCount })}</div>
        </div>
      </button>
      {/* Always reachable on touch screens; a mouse reveals it on hover. */}
      <ListingActionsMenu
        listing={listing}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-within:opacity-100 pointer-fine:has-[[aria-expanded=true]]:opacity-100"
      />
    </li>
  );
}
