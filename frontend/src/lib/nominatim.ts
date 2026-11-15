/** Nominatim (OpenStreetMap) place search + reverse geocoding.
 *
 * Usage policy: identified User-Agent, debounced from the UI, low volume,
 * attribution shown next to the search box.
 */

import { cityCenter } from "@/lib/city";

const BASE = "https://nominatim.openstreetmap.org";
const UA_HEADERS = { Accept: "application/json" };

function viewbox(): string {
  // ~55 km box around the deployment city (Vaniyambadi region).
  const { lat, lng } = cityCenter();
  const dLat = 0.5;
  const dLng = 0.55;
  // left,top,right,bottom
  return `${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)},${(lat - dLat).toFixed(4)}`;
}

export interface Place {
  displayName: string;
  shortName: string;
  lat: number;
  lng: number;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const params = new URLSearchParams({
    format: "json",
    limit: "6",
    countrycodes: "in",
    viewbox: viewbox(),
    "accept-language": "en",
    q: query,
  });
  const response = await fetch(`${BASE}/search?${params.toString()}`, { headers: UA_HEADERS });
  if (!response.ok) return [];
  const json = (await response.json()) as Array<{ display_name: string; lat: string; lon: string; name?: string }>;
  return json.map((row) => ({
    displayName: row.display_name,
    shortName: row.name || row.display_name.split(",").slice(0, 2).join(", "),
    lat: Number(row.lat),
    lng: Number(row.lon),
  }));
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const params = new URLSearchParams({
    format: "json",
    lat: String(lat),
    lon: String(lng),
    zoom: "17",
    addressdetails: "1",
    "accept-language": "en",
  });
  const response = await fetch(`${BASE}/reverse?${params.toString()}`, { headers: UA_HEADERS });
  if (!response.ok) return "";
  const json = (await response.json()) as { display_name?: string; error?: string };
  return json.display_name ?? "";
}

/** Strip the trailing country/postcode bits for a cleaner editable address. */
export function cleanAddress(displayName: string): string {
  const parts = displayName.split(", ");
  if (parts.length > 3 && parts[parts.length - 1]?.match(/^\d{6}$/)) parts.pop();
  if (parts[parts.length - 1] === "India") parts.pop();
  return parts.join(", ");
}
