import { Files, Heart, Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";
import type { Profile } from "@/lib/types";
import { AccountMenu } from "./AccountMenu";
import { ClayLogo } from "./ClayLogo";
import { OpenInNewTab } from "./OpenInNewTab";
import { SlackBanner } from "./SlackBanner";
import styles from "./Header.module.css";

interface Props {
  user: Profile;
  active?: "discover" | "mine" | "favorites" | null;
  /** Show the "join #auto-clayprompts" banner under the header (decided server-side). */
  slackNudge?: boolean;
}

export function Header({ user, active = null, slackNudge = false }: Props) {
  return (
    <>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <ClayLogo className={styles.logo} />
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
          href="/favorites"
          className={styles.navLink}
          aria-current={active === "favorites" ? "page" : undefined}
        >
          <Heart weight="fill" size={14} className={styles.heart} />
          Favorites
        </Link>
        <Link
          href="/mine"
          className={styles.navLink}
          aria-current={active === "mine" ? "page" : undefined}
        >
          Created
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
    {slackNudge ? <SlackBanner /> : null}
    </>
  );
}
