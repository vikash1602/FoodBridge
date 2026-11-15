/**
 * Live connection: SSE first, automatic polling fallback.
 *
 * - Primary: native EventSource on /api/v1/stream/?token=… (auto-reconnect,
 *   sends Last-Event-ID so no event is ever missed).
 * - Fallback: if SSE errors twice in a row, degrade to 10s polling of the
 *   API and keep retrying SSE in the background.
 */

import { useEffect, useRef, useState } from "react";

import { api, streamUrl, streamUrlSync } from "@/api/client";

export interface LiveMessage {
  id: number;
  event: string;
  payload: Record<string, unknown>;
}

type Mode = "sse" | "polling" | "offline";

export function useLiveEvents(onMessage: (message: LiveMessage) => void, enabled = true): Mode {
  const [mode, setMode] = useState<Mode>("sse");
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const lastIdRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      setMode("offline");
      return;
    }

    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let disposed = false;

    const handleFrame = (event: MessageEvent | { data: string; lastEventId?: string }) => {
      try {
        const parsed = JSON.parse(event.data) as { type: string; payload: Record<string, unknown> };
        const id = Number((event as MessageEvent).lastEventId ?? 0) || lastIdRef.current + 1;
        lastIdRef.current = Math.max(lastIdRef.current, id);
        handlerRef.current({ id, event: parsed.type, payload: parsed.payload });
      } catch {
        /* malformed frame — ignore */
      }
    };

    const startPolling = () => {
      if (disposed || pollTimer) return;
      setMode("polling");
      pollTimer = setInterval(async () => {
        try {
          const notifications = await api.get<{ results: { id: number; type: string; message: string }[] }>(
            "/notifications/?unread=true&page_size=10",
          );
          for (const notification of notifications.results ?? []) {
            handlerRef.current({
              id: notification.id,
              event: `notif.${notification.type}`,
              payload: { message: notification.message, notification_id: notification.id },
            });
          }
        } catch {
          /* keep polling silently */
        }
      }, 10_000);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connect = async () => {
      if (disposed) return;
      let url = streamUrlSync();
      try {
        url = await streamUrl(); // awaits the single-use ticket POST
      } catch {
        /* fall back to unauthenticated stream */
      }
      // The await above gives cleanup a window to run (StrictMode, route
      // changes). Without this guard an ORPHAN EventSource leaks and eats one
      // of the browser's 6 connections per host — eventually wedging all
      // fetches to the API.
      if (disposed) return;
      source?.close();
      source = new EventSource(url);
      source.onopen = () => {
        failures = 0;
        stopPolling();
        setMode("sse");
      };
      source.onmessage = handleFrame;
      const known = [
        "listing.created",
        "listing.new_nearby",
        "listing.claimed",
        "listing.picked_up",
        "listing.delivered",
        "listing.reopened",
        "listing.cancelled",
        "report.filed",
        "report.resolved",
        "account.suspended",
        "account.unsuspended",
      ];
      for (const name of known) {
        source.addEventListener(name, (event) => handleFrame(event as MessageEvent));
      }
      source.onerror = () => {
        failures += 1;
        if (failures >= 2) startPolling();
        // EventSource auto-reconnects; if it gave up (CLOSED), retry ourselves
        // with a FRESH ticket (old one is single-use).
        if (source && source.readyState === EventSource.CLOSED) {
          source.close();
          source = null;
          if (!disposed) setTimeout(() => void connect(), 3_000);
        }
      };
    };
    void connect();

    connect();
    return () => {
      disposed = true;
      source?.close();
      stopPolling();
    };
  }, [enabled]);

  return mode;
}
