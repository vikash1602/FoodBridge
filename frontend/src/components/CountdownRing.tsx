/** Circular kitchen-timer dial that drains and shifts green -> amber -> red. */

import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown, urgencyColors, urgencyFromSeconds } from "@/lib/format";
import { clsx } from "clsx";

interface Props {
  safeUntil: string;
  size?: number;
  label?: boolean;
  className?: string;
}

export function CountdownRing({ safeUntil, size = 52, label = true, className }: Props) {
  const secondsLeft = useCountdown(safeUntil);
  const urgency = urgencyFromSeconds(secondsLeft);
  const colors = urgencyColors[urgency];

  // Full window: from listing creation (approx) to safe_until; dial = fraction left.
  const total = Math.max(1, (new Date(safeUntil).getTime() - (Date.now() - 6 * 3600_000)) / 1000);
  const fraction = Math.min(1, secondsLeft / Math.min(total, 6 * 3600));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className={clsx("flex items-center gap-2", className)} role="timer" aria-label={`Safe for ${formatCountdown(secondsLeft)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={5}
          className="stroke-[color:var(--fb-line)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={clsx(colors.ring, "transition-all duration-1000 ease-linear")}
        />
      </svg>
      {label && (
        <span className={clsx("text-sm font-extrabold tabular-nums", colors.text)}>
          {formatCountdown(secondsLeft)}
        </span>
      )}
    </div>
  );
}
