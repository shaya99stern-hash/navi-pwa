import Image from "next/image";

export function NaviMark({ className = "", label = "Navi" }: { className?: string; label?: string }) {
  return (
    <Image
      src="/pwa-icon-192-v4.png"
      alt={label}
      width={192}
      height={192}
      className={className}
    />
  );
}
