import Image from "next/image";

import brandMark from "./baijie-mark.webp";

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src={brandMark}
      className={className}
      width={32}
      height={32}
      alt=""
      aria-hidden="true"
      unoptimized
    />
  );
}
