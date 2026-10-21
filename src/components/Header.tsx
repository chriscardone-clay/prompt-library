import { Files, FlowArrow, Heart, Plus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";
import { enablementEnabled, isAdmin, workflowsEnabled } from "@/lib/data";
import { isReviewer } from "@/lib/enablement";
import type { Profile } from "@/lib/types";
import { AccountMenu } from "./AccountMenu";
import { ClayLogo } from "./ClayLogo";
import { OpenInNewTab } from "./OpenInNewTab";
import { SlackBanner } from "./SlackBanner";
import styles from "./Header.module.css";

interface Props {
  user: Profile;
  active?: "discover" | "mine" | "favorites" | "enablement" | null;
  /** Show the "join #auto-clayprompts" banner under the header (decided server-side). */
  slackNudge?: boolean;
}

export async function Header({ user, active = null, slackNudge = false }: Props) {
  const [workflows, enablement] = await Promise.all([workflowsEnabled(), enablementEnabled()]);
  // The review queue: Enablement reviewers, plus admins (who manage the reviewers list).
  const enablementNav = enablement && ((await isReviewer()) || (await isAdmin()));
  return (
    <>
    {/* With four nav links, the secondary "New" buttons go icon-only on narrower screens. */}
    <header className={styles.header} data-busy={enablementNav && workflows ? "" : undefined}>
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
        {enablementNav ? (
          <Link href="/enablement" className={styles.navLink} aria-current={active === "enablement" ? "page" : undefined}>
            Enablement
          </Link>
        ) : null}
      </nav>
      <div className="grow" />
      <div className={styles.actions}>
        {workflows ? (
          <Link href="/workflows/new" className={`btn btn-outline ${styles.newWorkflow} ${styles.compact}`} aria-label="New workflow" title="New workflow">
            <FlowArrow weight="bold" size={14} />
            <span className={styles.newLabel}>New workflow</span>
          </Link>
        ) : null}
        <Link href="/skills/new" className={`btn btn-outline ${styles.compact}`} aria-label="New skill" title="New skill">
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
