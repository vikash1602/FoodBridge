/** Uber-style location picker shared by donors (post listing) and volunteers (base location).
 *
 *  - Auto-detects browser geolocation on open (zoom 17); silently falls back to
 *    the city centre after 3 s.
 *  - FIXED centre pin: the user drags the map under it; the address reverse-
 *    geocodes (debounced, cached, "locating…" shimmer) when movement stops.
 *  - Nominatim autocomplete (top 5, IN-bounded, attributed).
 *  - One-tap options: current location, "same as organization", recent places,
 *    and quick-area chips from the config endpoint.
 *  - A "Confirm location" action; never blocks on geocoding failure.
 */

import { useQuery } from "@tanstack/react-query";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

import type { Listing, Organization, Paginated } from "@/api/types";
import { api } from "@/api/client";
import { usePlatformConfig } from "@/lib/city";
import { cleanAddress, reverseGeocode, searchPlaces, type Place } from "@/lib/nominatim";
import { clsx } from "clsx";

const GEO_TIMEOUT_MS = 3000;
const REVERSE_DEBOUNCE_MS = 500;

export interface LocationPickerProps {
  value: [number, number];
  onChange: (position: [number, number]) => void;
  onAddress?: (address: string) => void;
  address?: string;
  /** Show a confirm button (mobile-friendly); fires once confirmed. */
  onConfirm?: () => void;
  confirmLabel?: string;
  showRecentPlaces?: boolean;
  showOrganizationAddress?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ */

function DraggableMap({ value, onSettle }: { value: [number, number]; onSettle: (position: [number, number]) => void }) {
  const map = useMap();
  // Keep the map centred on the value when it changes from outside (search/chips).
  useEffect(() => {
    map.setView(value, map.getZoom());
  }, [value, map]);

  useMapEvents({
    moveend() {
      const centre = map.getCenter();
      onSettle([centre.lat, centre.lng]);
    },
  });
  return null;
}

/* ------------------------------------------------------------------ */

export function LocationPicker({
  value,
  onChange,
  onAddress,
  address,
  onConfirm,
  confirmLabel = "Confirm location",
  showRecentPlaces = false,
  showOrganizationAddress = false,
  className,
}: LocationPickerProps) {
  const config = usePlatformConfig();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoPending, setGeoPending] = useState(true);
  const geocodeCache = useRef(new Map<string, string>());

  const pin = useMemo(
    () =>
      L.divIcon({
        className: "fb-marker fb-pin-fixed",
        html: '<div class="fb-plate" style="background:#D98E14;box-shadow:0 6px 16px rgba(0,0,0,.45)">📍</div>',
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      }),
    [],
  );

  /* --- auto-detect once on mount ------------------------------------ */
  const locateMe = useCallback(
    (zoom = 17) => {
      if (!("geolocation" in navigator)) {
        setGeoPending(false);
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (geo) => {
          const position: [number, number] = [geo.coords.latitude, geo.coords.longitude];
          onChange(position);
          setLocating(false);
          setGeoPending(false);
          void reverseGeocode(position[0], position[1]).then((name) => {
            if (name && onAddress) onAddress(cleanAddress(name));
          });
          void zoom;
        },
        () => {
          // Silent fallback to the city centre — no error UX.
          setLocating(false);
          setGeoPending(false);
        },
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 30_000 },
      );
    },
    [onChange, onAddress],
  );

  useEffect(() => {
    locateMe();
    const timer = setTimeout(() => setGeoPending(false), GEO_TIMEOUT_MS + 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- debounced reverse geocode on map settle ----------------------- */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSettle = useCallback(
    (position: [number, number]) => {
      onChange(position);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(async () => {
        const key = position.map((n) => n.toFixed(4)).join(",");
        const cached = geocodeCache.current.get(key);
        if (cached) {
          if (onAddress) onAddress(cached);
          return;
        }
        setLocating(true);
        try {
          const name = await reverseGeocode(position[0], position[1]);
          if (name) {
            const cleaned = cleanAddress(name);
            geocodeCache.current.set(key, cleaned);
            if (onAddress) onAddress(cleaned);
          }
        } catch {
          /* keep coordinates; the donor can type the address */
        } finally {
          setLocating(false);
        }
      }, REVERSE_DEBOUNCE_MS);
    },
    [onChange, onAddress],
  );

  /* --- debounced Nominatim search ------------------------------------ */
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length < 3) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        setResults(await searchPlaces(query.trim()));
        setOpen(true);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  /* --- one-tap data --------------------------------------------------- */
  const { data: orgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.get<Paginated<Organization>>("/organizations/"),
    enabled: showOrganizationAddress,
  });
  const org = orgs?.results.find((candidate) => candidate.is_approved);

  const { data: mine } = useQuery({
    queryKey: ["listings", "mine"],
    queryFn: () => api.get<Paginated<Listing>>("/listings/mine/?page_size=20"),
    enabled: showRecentPlaces,
  });
  const recentPlaces = useMemo(() => {
    const seen = new Set<string>();
    const places: Array<{ label: string; lat: number; lng: number }> = [];
    for (const listing of mine?.results ?? []) {
      const key = `${listing.lat.toFixed(3)},${listing.lng.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({ label: listing.pickup_address.slice(0, 38), lat: listing.lat, lng: listing.lng });
      if (places.length >= 3) break;
    }
    return places;
  }, [mine]);

  const jumpTo = (position: [number, number], label?: string) => {
    onChange(position);
    if (label && onAddress) onAddress(label);
    setOpen(false);
  };

  return (
    <div className={className}>
      {/* search with autocomplete */}
      <div className="relative mb-2">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--fb-ink-soft)]" aria-hidden />
        <input
          className="input pl-9"
          placeholder={`Search in & around ${config.city_name}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          aria-label="Search for a place"
        />
        {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[color:var(--fb-ink-soft)]" aria-hidden />}
        {open && results.length > 0 && (
          <ul
            className="absolute z-[1000] mt-1 max-h-44 w-full overflow-y-auto rounded-xl border border-[color:var(--fb-line)] bg-[color:var(--fb-surface)] shadow-lift scrollbar-thin"
            role="listbox"
          >
            {results.map((place, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-forest-50 dark:hover:bg-pantry-700"
                  onClick={() => jumpTo([place.lat, place.lng], place.shortName)}
                  role="option"
                  aria-selected={false}
                >
                  <span className="font-semibold">{place.shortName}</span>
                  <span className="block truncate text-[11px] text-[color:var(--fb-ink-soft)]">{place.displayName}</span>
                </button>
              </li>
            ))}
            <li className="border-t border-[color:var(--fb-line)] px-3 py-1 text-[10px] text-[color:var(--fb-ink-soft)]">
              Place search © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors (Nominatim)
            </li>
          </ul>
        )}
      </div>

      {/* quick-area chips */}
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick areas">
        {config.quick_areas?.map((area) => (
          <button
            key={area.name}
            type="button"
            onClick={() => jumpTo([area.lat, area.lng], `${area.name}, ${config.city_name}`)}
            className={clsx(
              "chip transition-colors",
              Math.abs(value[0] - area.lat) < 0.002 && Math.abs(value[1] - area.lng) < 0.002
                ? "bg-forest-700 text-paper"
                : "bg-[color:var(--fb-line)]/50 hover:bg-forest-100 dark:hover:bg-pantry-700",
            )}
          >
            <MapPin size={10} aria-hidden /> {area.name}
          </button>
        ))}
      </div>

      {/* map with FIXED centre pin */}
      <div className="relative h-64 overflow-hidden rounded-2xl border border-[color:var(--fb-line)]">
        <MapContainer center={value} zoom={17} className="h-full w-full" scrollWheelZoom>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          <DraggableMap value={value} onSettle={handleSettle} />
          <Marker position={value} icon={pin} interactive={false} />
        </MapContainer>

        {/* fixed centre pin overlay (decorative; the real marker tracks the centre) */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full" aria-hidden>
          <div className="h-2 w-2 animate-ping rounded-full bg-saffron-500/60" />
        </div>
        {geoPending && (
          <div className="absolute inset-x-0 top-0 z-[600] flex items-center justify-center bg-pantry-950/70 py-1 text-[11px] font-bold uppercase tracking-widest text-paper" role="status">
            <Loader2 size={12} className="mr-1.5 animate-spin" aria-hidden /> locating…
          </div>
        )}
      </div>

      {/* one-tap row */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-outline h-9 text-xs" onClick={() => locateMe(17)}>
          <Crosshair size={14} aria-hidden /> Use my current location
        </button>
        {showOrganizationAddress && org && org.lat != null && org.lng != null && (
          <button
            type="button"
            className="btn-outline h-9 text-xs"
            onClick={() => jumpTo([org.lat as number, org.lng as number], org.address)}
          >
            <MapPin size={14} aria-hidden /> Same as {org.name}
          </button>
        )}
        {locating && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--fb-ink-soft)]" role="status">
            <Loader2 size={12} className="animate-spin" aria-hidden /> locating…
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums text-[color:var(--fb-ink-soft)]">
          {value[0].toFixed(5)}, {value[1].toFixed(5)}
        </span>
      </div>

      {/* recent places */}
      {showRecentPlaces && recentPlaces.length > 0 && (
        <div className="mt-2">
          <p className="label !mb-1">Recent places</p>
          <div className="flex flex-wrap gap-1.5">
            {recentPlaces.map((place) => (
              <button
                key={place.label}
                type="button"
                onClick={() => jumpTo([place.lat, place.lng], place.label)}
                className="chip bg-saffron-100 text-saffron-800 hover:bg-saffron-200"
              >
                {place.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* current address readout */}
      {address !== undefined && (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-[color:var(--fb-line)]/30 px-3 py-2 text-xs text-[color:var(--fb-ink-soft)]">
          <MapPin size={12} className="mt-0.5 shrink-0" aria-hidden />
          {address || "Drag the map to fill the address — or type it yourself."}
        </p>
      )}

      {onConfirm && (
        <button type="button" className="btn-primary mt-3 h-12 w-full text-base" onClick={onConfirm}>
          {confirmLabel}
        </button>
      )}
    </div>
  );
}
