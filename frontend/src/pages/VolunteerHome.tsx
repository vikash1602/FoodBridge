/** Volunteer home: split view — receipt feed on the left, live map on the right.
 *  The Leaflet map is code-split (lazy) so it never blocks first paint. */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Compass, Filter, MapPin } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { api, HttpError, qs } from "@/api/client";
import type { Listing, Paginated } from "@/api/types";
import { ListingTicket } from "@/components/ListingTicket";
import { EmptyState, ErrorState, LiveDot, ListingCardSkeleton, Skeleton } from "@/components/ui";
import { useGeolocation } from "@/hooks/useGeolocation";
import { foodTypeEmoji } from "@/lib/format";
import { clsx } from "clsx";

const FeedMap = lazy(() => import("@/components/FeedMap"));

const FOOD_TYPES = ["cooked", "packaged", "raw", "bakery", "other"] as const;
// Match the deployment's escalation tiers (settings-configurable).
const RADII = [3, 6, 12] as const;

export function VolunteerHomePage() {
  const geo = useGeolocation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [radius, setRadius] = useState<number>(12);
  const [vegOnly, setVegOnly] = useState(false);
  const [foodType, setFoodType] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["listings", "feed", geo.lat, geo.lng, radius, vegOnly, foodType],
    queryFn: () =>
      api.get<Paginated<Listing>>(
        `/listings/${qs({
          lat: geo.lat.toFixed(5),
          lng: geo.lng.toFixed(5),
          radius,
          veg: vegOnly ? "true" : undefined,
          type: foodType || undefined,
          page_size: 30,
        })}`,
      ),
    placeholderData: keepPreviousData, // previous feed stays visible while refetching
    refetchInterval: 30_000,
  });

  const listings = useMemo(() => data?.results ?? [], [data]);
  const knownIdsRef = useRef<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  // Mobile gets a List/Map switch; desktop shows both side by side.
  const [mobileView, setMobileView] = useState<"list" | "map">("list");

  useEffect(() => {
    const fresh = listings.filter((listing) => !knownIdsRef.current.has(listing.id));
    for (const listing of listings) knownIdsRef.current.add(listing.id);
    if (fresh.length > 0 && knownIdsRef.current.size > fresh.length) {
      setNewIds(new Set(fresh.map((listing) => listing.id)));
      const timer = setTimeout(() => setNewIds(new Set()), 2500);
      return () => clearTimeout(timer);
    }
  }, [listings]);

  const claimMutation = useMutation({
    mutationFn: (listing: Listing) => api.post<unknown>(`/listings/${listing.id}/claim/`),
    onSuccess: (_data, listing) => {
      toast.success(`Claimed “${listing.title}”! Show this to no one — get the code from the donor page. 🫡`);
      queryClient.invalidateQueries({ queryKey: ["listings"] });
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      navigate("/app/my-claims");
    },
    onError: (mutationError, listing) => {
      const httpError = mutationError as HttpError;
      toast.error(httpError.body?.message ?? `Could not claim “${listing.title}”`);
      if (httpError.status === 409) {
        queryClient.invalidateQueries({ queryKey: ["listings"] });
      }
    },
  });

  const selected = listings.find((listing) => listing.id === selectedId);

  return (
    /* Dashboard split: feed + map start on the same line and fill the height
       the shell gives them (desktop). Mobile switches between list and map. */
    <div className="grid gap-4 lg:h-[calc(100dvh-4rem-3rem)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      {/* Feed */}
      <section
        aria-label="Nearby food feed"
        className={clsx(
          "min-h-0 min-w-0 lg:row-start-1 lg:overflow-y-auto lg:pr-1 scrollbar-thin",
          mobileView === "map" && "hidden lg:block",
        )}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-2xl font-black" data-tour="feed-heading">
              Rescue feed{" "}
              <span className="align-middle text-sm font-bold text-[color:var(--fb-ink-soft)]">
                ({data?.count ?? 0})
              </span>
            </h1>
            <p className="text-xs text-[color:var(--fb-ink-soft)]">Sorted by urgency × distance</p>
          </div>
          <div className="flex items-center gap-2">
            <LiveDot live />
            <button
              className={clsx("btn-outline h-9 text-xs", showFilters && "border-forest-500 text-forest-700")}
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              data-tour="filters"
            >
              <Filter size={14} aria-hidden /> Filters
            </button>
            {/* Mobile List/Map switch */}
            <div
              className="flex rounded-full border border-[color:var(--fb-line)] bg-[color:var(--fb-surface)] p-0.5 text-[11px] font-extrabold lg:hidden"
              role="group"
              aria-label="Feed or map view"
            >
              {(["list", "map"] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setMobileView(view)}
                  aria-pressed={mobileView === view}
                  className={clsx(
                    "rounded-full px-2.5 py-0.5 capitalize transition-colors",
                    mobileView === view ? "bg-forest-700 text-paper" : "text-[color:var(--fb-ink-soft)]",
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
          </div>
        </div>

        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="ticket mb-4 flex flex-wrap items-center gap-2 overflow-hidden p-3"
          >
            <span className="label !mb-0">Radius</span>
            {RADII.map((value) => (
              <button
                key={value}
                onClick={() => setRadius(value)}
                className={clsx("chip", radius === value ? "bg-forest-700 text-paper" : "bg-[color:var(--fb-line)]/60")}
                aria-pressed={radius === value}
              >
                {value} km
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-[color:var(--fb-line)]" aria-hidden />
            <button
              onClick={() => setVegOnly((value) => !value)}
              className={clsx("chip", vegOnly ? "bg-forest-600 text-white" : "bg-[color:var(--fb-line)]/60")}
              aria-pressed={vegOnly}
            >
              🌿 Veg only
            </button>
            <span className="mx-1 h-5 w-px bg-[color:var(--fb-line)]" aria-hidden />
            <span className="label !mb-0">Type</span>
            {FOOD_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setFoodType(foodType === type ? "" : type)}
                className={clsx("chip", foodType === type ? "bg-saffron-500 text-pantry-950" : "bg-[color:var(--fb-line)]/60")}
                aria-pressed={foodType === type}
              >
                {foodTypeEmoji[type]} {type}
              </button>
            ))}
          </motion.div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {isLoading &&
            Array.from({ length: 4 }).map((_, index) => <ListingCardSkeleton key={index} />)}
          {isError && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}
          {!isLoading && !isError && listings.length === 0 && (
            <div className="col-span-full">
              <EmptyState
                emoji="🍽️"
                title="No food waiting nearby"
                hint={
                  vegOnly || foodType
                    ? "No open listings match your filters right now."
                    : "No open listings within your radius at the moment — kitchens post surplus throughout the day, so this can change any minute."
                }
                next={[
                  vegOnly || foodType ? "Clear the veg/type filters to see everything." : "Widen the radius to see food further out.",
                  "Check back soon — new rescues appear live with a ping.",
                  "Raise your notify radius in Profile to hear about food first.",
                ]}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <button className="btn-outline" onClick={() => setRadius(12)}>
                      <Compass size={16} aria-hidden /> Widen to 12 km
                    </button>
                    {(vegOnly || foodType) && (
                      <button
                        className="btn-outline"
                        onClick={() => {
                          setVegOnly(false);
                          setFoodType("");
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                }
              />
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {listings.map((listing) => (
              <div
                key={listing.id}
                onMouseEnter={() => setHoveredId(listing.id)}
                onMouseLeave={() => setHoveredId(null)}
                data-tour="listing-card"
              >
                <ListingTicket
                  listing={listing}
                  onClaim={(target) => claimMutation.mutate(target)}
                  claiming={claimMutation.isPending && claimMutation.variables?.id === listing.id}
                  highlighted={hoveredId === listing.id}
                  isNew={newIds.has(listing.id)}
                />
              </div>
            ))}
          </AnimatePresence>
        </div>
      </section>

      {/* Map — fills the row height; on mobile shown via the List/Map switch
          with an explicit height (Leaflet cannot render in an auto-height box) */}
      <section
        aria-label="Map of nearby food"
        className={clsx(
          "h-80 min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[color:var(--fb-line)] shadow-card lg:h-auto lg:row-start-1",
          mobileView === "list" && "hidden lg:block",
        )}
        data-tour="map"
      >
        <Suspense
          fallback={
            <div className="grid h-full place-items-center">
              <Skeleton className="h-full w-full rounded-none" />
            </div>
          }
        >
          <FeedMap
            listings={listings}
            center={[geo.lat, geo.lng]}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(lat, lng) => {
              localStorage.setItem("fb.geo", JSON.stringify({ lat, lng }));
            }}
          />
        </Suspense>
        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ y: 90 }}
              animate={{ y: 0 }}
              exit={{ y: 110 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              className="absolute inset-x-3 bottom-3 z-10"
            >
              <div className="ticket flex items-center gap-3 p-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-forest-100 text-xl dark:bg-forest-900">
                  {foodTypeEmoji[selected.food_type]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display font-bold">{selected.title}</p>
                  <p className="text-xs text-[color:var(--fb-ink-soft)]">
                    {selected.quantity} ·{" "}
                    {selected.distance_km !== undefined && selected.distance_km !== null ? (
                      <>
                        <MapPin size={10} className="inline" /> {selected.distance_km} km ·{" "}
                      </>
                    ) : null}
                    {selected.pickup_address}
                  </p>
                </div>
                <button
                  className="btn-saffron h-10 px-4 text-sm"
                  onClick={() => navigate(`/app/listings/${selected.id}`)}
                >
                  Open
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
