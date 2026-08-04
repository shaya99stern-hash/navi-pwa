import Image from "next/image";

export function NaviMark({ className = "", label = "NaviOS" }: { className?: string; label?: string }) {
  return (
    <Image
      src="/brand-spark.png"
      alt={label}
      width={564}
      height={564}
      className={className}
      priority
    />
  );
}
