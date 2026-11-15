/** Browser geolocation with a graceful default (the deployment city centre). */

import { useCallback, useEffect, useState } from "react";

import { cityCenter } from "@/lib/city";

export const DEFAULT_CENTER: [number, number] = [cityCenter().lat, cityCenter().lng];

export interface GeoState {
  lat: number;
  lng: number;
  source: "granted" | "default" | "saved";
  ready: boolean;
}

export function useGeolocation(): GeoState & { request: () => void } {
  const [state, setState] = useState<GeoState>({
    lat: DEFAULT_CENTER[0],
    lng: DEFAULT_CENTER[1],
    source: "default",
    ready: false,
  });

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          source: "granted",
          ready: true,
        });
        localStorage.setItem("fb.geo", JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude }));
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("fb.geo");
    if (saved) {
      try {
        const { lat, lng } = JSON.parse(saved) as { lat: number; lng: number };
        setState({ lat, lng, source: "saved", ready: true });
        return;
      } catch {
        /* fall through to default */
      }
    }
    setState((prev) => ({ ...prev, ready: true }));
    request();
  }, [request]);

  return { ...state, request };
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}
