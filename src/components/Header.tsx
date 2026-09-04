import { Files, Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";
import type { Profile } from "@/lib/types";
import { AccountMenu } from "./AccountMenu";
import { OpenInNewTab } from "./OpenInNewTab";
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
          My library
        </Link>
      </nav>
      <div className="grow" />
      <div className={styles.actions}>
        <Link href="/skills/new" className="btn btn-outline">
          <Files weight="bold" size={14} />
          <span className={styles.newLabel}>New skill</span>
        </Link>
        <Link href="/prompts/new" className="btn btn-primary">
          <Plus weight="bold" size={14} />
          <span className={styles.newLabel}>New prompt</span>
        </Link>
      </div>
      <Suspense fallback={null}>
        <OpenInNewTab className={`icon-btn ${styles.openOut}`} />
      </Suspense>
      <AccountMenu user={user} />
    </header>
  );
}
