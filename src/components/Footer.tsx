import Link from "next/link";
import { AUTHOR_HANDLE, AUTHOR_SLACK_URL } from "@/lib/constants";
import { canManageIntegrations, getCurrentUser, isAdmin, workflowsEnabled } from "@/lib/data";
import styles from "./Footer.module.css";

/**
 * Site-wide footer: the author credit, and for admins only, the link to /admin.
 * Rendered from the root layout so it sits at the very bottom of every page.
 */
export async function Footer() {
  const user = await getCurrentUser();
  const admin = user ? await isAdmin() : false;
  // Workflow maintainers aren't admins but run the Integrations catalog.
  const maintainer = user && !admin ? (await workflowsEnabled()) && (await canManageIntegrations()) : false;
  return (
    <footer className={`${styles.footer} embed-hide`}>
      <span>
        Made by{" "}
        <a href={AUTHOR_SLACK_URL} target="_blank" rel="noopener noreferrer" className={styles.handle}>
          {AUTHOR_HANDLE}
        </a>
      </span>
      {maintainer ? (
        <>
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
          <Link href="/admin/integrations" className={styles.admin}>
            Integrations
          </Link>
        </>
      ) : null}
      {admin ? (
        <>
          <span className={styles.dot} aria-hidden="true">
            ·
          </span>
          <Link href="/admin" className={styles.admin}>
            Admin
          </Link>
        </>
      ) : null}
    </footer>
  );
}
