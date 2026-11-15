/** Sticker-style trust badge. */

import { badgeEmoji, badgeStyles } from "@/lib/format";
import { clsx } from "clsx";

interface Props {
  badge: string;
  score?: number;
  size?: "sm" | "md";
}

export function TrustBadge({ badge, score, size = "sm" }: Props) {
  const style = badgeStyles[badge] ?? badgeStyles.new;
  return (
    <span
      className={clsx("sticker", style, size === "md" && "text-xs px-2.5 py-1")}
      title={score !== undefined ? `Trust score ${score}/100` : badge}
    >
      <span aria-hidden>{badgeEmoji[badge] ?? "🌱"}</span>
      {badge}
    </span>
  );
}
