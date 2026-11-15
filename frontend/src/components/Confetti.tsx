/** Kitchen-confetti burst for delivered rescues. Mount for ~2.5s. */

import { useMemo } from "react";

const COLORS = ["#D98E14", "#3B8A60", "#E14B2E", "#EABD5C", "#8DC3A0", "#F06449"];

export function Confetti({ pieces = 90 }: { pieces?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, index) => ({
        id: index,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 1.6 + Math.random() * 1.4,
        color: COLORS[index % COLORS.length] ?? "#D98E14",
        size: 7 + Math.random() * 7,
        round: Math.random() > 0.6,
      })),
    [pieces],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      {bits.map((bit) => (
        <span
          key={bit.id}
          className="confetti-piece"
          style={{
            left: `${bit.left}%`,
            width: bit.size,
            height: bit.round ? bit.size : bit.size * 1.5,
            background: bit.color,
            borderRadius: bit.round ? "9999px" : "2px",
            animationDelay: `${bit.delay}s`,
            animationDuration: `${bit.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
