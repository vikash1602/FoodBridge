/** Ticking countdown to a future ISO timestamp (1s resolution). */

import { useEffect, useState } from "react";

export function useCountdown(iso: string | undefined): number {
  const target = iso ? new Date(iso).getTime() : 0;
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.floor((target - Date.now()) / 1000)));

  useEffect(() => {
    if (!target) return;
    setSecondsLeft(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    const timer = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [target]);

  return secondsLeft;
}
