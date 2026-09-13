import { useEffect, useState } from "react";
import { CheckCircle2, Menu } from "lucide-react";
import { navigate } from "@/app/router";
import { useComposerStore } from "@/app/stores/composer-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { usePublishStore } from "@/app/stores/publish-store";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Misc";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { ListingActionsMenu } from "../listings/ListingActionsMenu";
import { ListingCopyPanel } from "./ListingCopyPanel";
import { ListingSetupCard } from "./ListingSetupCard";
import { GenerationFeed } from "../generation/GenerationFeed";
import { Lightbox } from "../gallery/Lightbox";
import { SelectionBar } from "../gallery/SelectionBar";
import { PostButton } from "../publish/PostButton";
import { PublishPanel } from "../publish/PublishPanel";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { SourcePanel } from "./SourcePanel";

export function WorkspaceView({ listingId }: { listingId: string }) {
  const t = useT();
  const current = useListingsStore((s) => s.current);
  const loading = useListingsStore((s) => s.loadingListing);
  const open = useListingsStore((s) => s.open);
  const bindListing = useComposerStore((s) => s.bindListing);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const leaveListing = useUiStore((s) => s.leaveListing);
  // The Vinted window is open for this listing: the publication panel takes over the left column.
  const publishing = usePublishStore((s) => s.session.stage !== "closed" && s.session.listingId === listingId);
  useWorkspaceShortcuts();

  useEffect(() => {
    leaveListing();
    void open(listingId).then((doc) => {
      if (!doc) navigate({ name: "home" }, true);
      else bindListing(doc.listing.id);
    });
    // Leaving through the sidebar (or to another listing): the viewer must not still be open on return.
    return leaveListing;
  }, [listingId, open, bindListing, leaveListing]);

  const doc = current?.listing.id === listingId ? current : null;
  const generationCount = doc ? Object.keys(doc.generations).length : 0;
  const imageCount = doc ? Object.values(doc.images).filter((i) => i.kind === "generation").length : 0;

  if (!doc) {
    return <div className="flex h-full items-center justify-center text-sm text-fg-muted">{loading ? t("common.loading") : null}</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label={t("nav.listings")}>
          <Menu className="size-5" />
        </Button>
        <ListingTitle name={doc.listing.name} />
        <ListingActionsMenu listing={{ id: doc.listing.id, name: doc.listing.name }} className="shrink-0" align="left" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-fg-subtle sm:inline">
            {t("history.generations", { count: generationCount })} · {t("listings.imageCount", { count: imageCount })}
          </span>
          <Segmented
            size="sm"
            ariaLabel={t("gallery.filter.all")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("gallery.filter.all") },
              {
                value: "toPost",
                label: (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> {t("gallery.filter.toPost")}
                  </span>
                ),
              },
            ]}
          />
          <PostButton />
        </div>
      </header>

      {/* Below lg the page scrolls as one column; from lg the composer and the gallery scroll independently. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section
          aria-label={t("composer.promptLabel")}
          className={cn("flex shrink-0 flex-col gap-4 border-b border-border p-4 lg:w-[22rem] lg:overflow-y-auto lg:border-r lg:border-b-0 xl:w-[24rem]")}
        >
          {publishing ? (
            <PublishPanel />
          ) : (
            <>
              <SourcePanel />
              <ListingSetupCard />
              <ListingCopyPanel />
            </>
          )}
        </section>
        <section aria-label={t("gallery.title")} className="relative flex-1 lg:min-h-0 lg:overflow-y-auto">
          <GenerationFeed />
        </section>
      </div>
      <SelectionBar />
      <Lightbox />
    </div>
  );
}

function ListingTitle({ name }: { name: string }) {
  const t = useT();
  const rename = useListingsStore((s) => s.rename);
  const current = useListingsStore((s) => s.current);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [seenName, setSeenName] = useState(name);
  if (seenName !== name) {
    setSeenName(name);
    setValue(name);
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={t("listings.rename.title")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (current && value.trim() && value !== name) void rename(current.listing.id, value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setValue(name);
            setEditing(false);
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-2 text-base font-semibold focus:ring-2 focus:ring-ring focus:outline-none md:max-w-md"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={t("common.rename")}
      className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-base font-semibold hover:bg-bg-elevated md:max-w-md md:flex-none"
    >
      {name}
    </button>
  );
}
