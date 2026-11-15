/** The Leaflet map for the volunteer home — code-split so leaflet only loads
 *  when the map is actually rendered. ResizeObserver keeps tiles aligned when
 *  the shell resizes; attribution keeps the required OSM credit without the
 *  "Leaflet" prefix. */

import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

import type { Listing } from "@/api/types";
import { foodTypeEmoji, formatCountdown, urgencyFromSeconds } from "@/lib/format";

export interface FeedMapProps {
  listings: Listing[];
  center: [number, number];
  hoveredId: number | null;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onMove: (lat: number, lng: number) => void;
}

function plateIcon(listing: Listing, active: boolean): L.DivIcon {
  const secondsLeft = (new Date(listing.safe_until).getTime() - Date.now()) / 1000;
  const urgency = urgencyFromSeconds(secondsLeft);
  const bg = urgency === "fresh" ? "#3B8A60" : urgency === "soon" ? "#E3A733" : urgency === "urgent" ? "#E14B2E" : "#78716c";
  return L.divIcon({
    className: "fb-marker",
    html: `<div class="fb-plate" style="background:${bg}; ${active ? "transform:scale(1.25)" : ""}" tabindex="0" role="button" aria-label="${listing.title}">${foodTypeEmoji[listing.food_type] ?? "🍱"}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/** Drops the "Leaflet" prefix while keeping the required OSM attribution. */
function AttributionCleanup() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl.setPrefix(false);
  }, [map]);
  return null;
}

/** Re-measures the canvas whenever its container changes size (sidebar
 *  transitions, viewport changes, panel switches) so tiles and markers align. */
function ResizeHandler() {
  const map = useMap();
  const containerRef = useRef<HTMLElement | null>(map.getContainer());
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export default function FeedMap({ listings, center, hoveredId, selectedId, onSelect, onMove }: FeedMapProps) {
  function ClickCatcher() {
    useMapEvents({
      click(event) {
        onMove(event.latlng.lat, event.latlng.lng);
      },
    });
    return null;
  }

  useEffect(() => {
    // ensure leaflet's default marker icons never 404 under bundlers
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
    L.Icon.Default.mergeOptions({ iconRetinaUrl: "", iconUrl: "" });
  }, []);

  return (
    <MapContainer center={center} zoom={13} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <AttributionCleanup />
      <ResizeHandler />
      <ClickCatcher />
      <CircleMarker
        center={center}
        radius={8}
        pathOptions={{ color: "#fff", weight: 3, fillColor: "#1E4533", fillOpacity: 1 }}
      >
        <Popup>You are here</Popup>
      </CircleMarker>
      {listings.map((listing) => (
        <div key={listing.id}>
          <Marker
            position={[listing.lat, listing.lng]}
            icon={plateIcon(listing, hoveredId === listing.id || selectedId === listing.id)}
            eventHandlers={{ click: () => onSelect(listing.id) }}
          >
            <Popup>
              <div className="min-w-44">
                <p className="font-bold">
                  {foodTypeEmoji[listing.food_type]} {listing.title}
                </p>
                <p className="text-xs">
                  {listing.quantity} ·{" "}
                  {listing.distance_km !== undefined && listing.distance_km !== null ? `${listing.distance_km} km · ` : ""}
                  safe {formatCountdown((new Date(listing.safe_until).getTime() - Date.now()) / 1000)}
                </p>
                <a
                  href={`/app/listings/${listing.id}`}
                  className="mt-1 inline-block rounded-md bg-forest-700 px-2 py-1 text-xs font-bold text-white"
                >
                  View & claim →
                </a>
              </div>
            </Popup>
          </Marker>
          {listing.escalation_radius_km && (
            <CircleMarker
              center={[listing.lat, listing.lng]}
              radius={listing.escalation_radius_km * 4}
              pathOptions={{
                color: "#D98E14",
                weight: 1.5,
                dashArray: "6 8",
                fillColor: "#D98E14",
                fillOpacity: 0.04,
              }}
              interactive={false}
            />
          )}
        </div>
      ))}
    </MapContainer>
  );
}
