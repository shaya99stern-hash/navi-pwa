import type { CSSProperties } from "react";

export function NaviMark({ className = "", label = "Navi" }: { className?: string; label?: string }) {
  const rays = Array.from({ length: 16 }, (_, index) => index * 22.5);
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="50" r="10" fill="currentColor" />
      {rays.map((rotation) => (
        <rect
          key={rotation}
          x="47"
          y="7"
          width="6"
          height="25"
          rx="3"
          fill="currentColor"
          style={{ transformOrigin: "50px 50px", transform: `rotate(${rotation}deg)` } as CSSProperties}
        />
      ))}
    </svg>
  );
}
