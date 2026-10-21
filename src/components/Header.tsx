import { Heart, Plugs } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";
import { enablementEnabled, isAdmin, workflowsEnabled } from "@/lib/data";
import { isReviewer } from "@/lib/enablement";
import type { Profile } from "@/lib/types";
import { AccountMenu } from "./AccountMenu";
import { ClayLogo } from "./ClayLogo";
import { NewMenu } from "./NewMenu";
import { OpenInNewTab } from "./OpenInNewTab";
import { SlackBanner } from "./SlackBanner";
import styles from "./Header.module.css";

interface Props {
  user: Profile;
  active?: "discover" | "favorites" | "enablement" | "connect" | null;
  /** Show the "join #auto-clayprompts" banner under the header (decided server-side). */
  slackNudge?: boolean;
}

export async function Header({ user, active = null, slackNudge = false }: Props) {
  const [workflows, enablement] = await Promise.all([workflowsEnabled(), enablementEnabled()]);
  // The review queue: Enablement reviewers, plus admins (who manage the reviewers list).
  const enablementNav = enablement && ((await isReviewer()) || (await isAdmin()));
  return (
    <>
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <ClayLogo className={styles.logo} />
        <span className={styles.brandLabel}>Prompt library</span>
      </Link>
      {/* Places in the library. */}
      <nav className={styles.nav} aria-label="Primary">
        <Link href="/" className={styles.navLink} aria-current={active === "discover" ? "page" : undefined}>
          Discover
        </Link>
        <Link href="/favorites" className={styles.navLink} aria-current={active === "favorites" ? "page" : undefined}>
          <Heart weight="fill" size={14} className={styles.heart} />
          Favorites
        </Link>
        {enablementNav ? (
          <Link href="/enablement" className={styles.navLink} aria-current={active === "enablement" ? "page" : undefined}>
            Enablement
          </Link>
        ) : null}
      </nav>
      {/* Things you do: take the library into your AI tools, add to it, your account. */}
      <div className={styles.actions}>
        <Link
          href="/connect"
          className={styles.useInAi}
          aria-current={active === "connect" ? "page" : undefined}
          aria-label="Use in AI: Claude, ChatGPT or Cursor"
          title="Use the library in Claude, ChatGPT or Cursor"
        >
          <Plugs weight="bold" size={15} />
          <span className={styles.useLabel}>Use in AI</span>
        </Link>
        <NewMenu workflows={workflows} />
        <Suspense fallback={null}>
          <OpenInNewTab className={`icon-btn ${styles.openOut}`} />
        </Suspense>
        <AccountMenu user={user} />
      </div>
    </header>
    {slackNudge ? <SlackBanner /> : null}
    </>
  );
}
