import Link from "next/link";
import { AUTHOR_HANDLE, AUTHOR_SLACK_URL } from "@/lib/constants";
import { getCurrentUser, isAdmin } from "@/lib/data";
import styles from "./Footer.module.css";

/**
 * Site-wide footer: the author credit, and for admins only, the link to /admin.
 * Rendered from the root layout so it sits at the very bottom of every page.
 */
export async function Footer() {
  const user = await getCurrentUser();
  const admin = user ? await isAdmin() : false;
  return (
    <footer className={`${styles.footer} embed-hide`}>
      <span>
        Made by{" "}
        <a href={AUTHOR_SLACK_URL} target="_blank" rel="noopener noreferrer" className={styles.handle}>
          {AUTHOR_HANDLE}
        </a>
      </span>
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
