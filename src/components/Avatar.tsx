import { avatarSrc, maskFor } from "@/lib/people";
import type { Person } from "@/lib/types";

interface Props {
  person: Pick<Person, "id" | "email" | "avatarUrl" | "name">;
  size?: number;
  className?: string;
}

/** Headshot masked with one of Terra's organic blob shapes. Never a circle. */
export function Avatar({ person, size = 26, className }: Props) {
  const mask = `url(${maskFor(person)})`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarSrc(person)}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      className={className}
      style={{
        width: size,
        height: size,
        flex: "none",
        objectFit: "cover",
        WebkitMaskImage: mask,
        maskImage: mask,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        background: "var(--oat-200)",
      }}
    />
  );
}
