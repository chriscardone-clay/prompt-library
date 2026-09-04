import { Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { Profile } from "@/lib/types";
import { AccountMenu } from "./AccountMenu";
import styles from "./Header.module.css";

interface Props {
  user: Profile;
  active?: "discover" | "mine" | null;
}

export function Header({ user, active = null }: Props) {
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/Clay_Logo_3D_Blk.png" alt="Clay" className={styles.logo} />
        <span className={styles.brandLabel}>Prompt library</span>
      </Link>
      <nav className={styles.nav} aria-label="Primary">
        <Link
          href="/"
          className={styles.navLink}
          aria-current={active === "discover" ? "page" : undefined}
        >
          Discover
        </Link>
        <Link
          href="/mine"
          className={styles.navLink}
          aria-current={active === "mine" ? "page" : undefined}
        >
          My prompts
        </Link>
      </nav>
      <div className="grow" />
      <Link href="/prompts/new" className="btn btn-primary">
        <Plus weight="bold" size={14} />
        New prompt
      </Link>
      <AccountMenu user={user} />
    </header>
  );
}
