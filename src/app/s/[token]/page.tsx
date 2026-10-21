import { DownloadSimple, FileText } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { ClayLogo } from "@/components/ClayLogo";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import { WorkflowDoc } from "@/components/WorkflowDoc";
import { tableOfContents } from "@/lib/markdown";
import { findPublicShare, recordShareView } from "@/lib/shares";
import { fileBytes, formatBytes } from "@/lib/skills";
import styles from "./share.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params;
  const share = await findPublicShare(token);
  return {
    title: share ? { absolute: `${share.title} · Shared by Clay` } : { absolute: "Link unavailable · Clay" },
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * A publish link: the snapshot of a customer-ready workflow, for someone
 * without a Clay sign-in. Reads only workflow_shares (lib/shares.ts) and shows
 * nothing about the library: no owners, notes, feedback, history or navigation.
 */
export default async function SharePage({ params }: { params: Params }) {
  const { token } = await params;
  const share = await findPublicShare(token);
  if (!share) return <Unavailable />;
  void recordShareView(share.id);
  const toc = tableOfContents(share.file.content);
  const published = new Date(share.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const base = `/s/${encodeURIComponent(token)}`;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerIn}>
          <ClayLogo className={styles.logo} />
          <span className={styles.label}>Shared by Clay</span>
          <span className={styles.date}>Published {published}</span>
        </div>
      </header>
      <main className={styles.main}>
        <section className={styles.hero}>
          <span className="eyebrow">Reference architecture · Clay Workflows</span>
          <h1 className="display-lg">{share.title}</h1>
          {share.description ? <p className={styles.lede}>{share.description}</p> : null}
          {share.attachments.length ? (
            <div className={styles.files}>
              {share.attachments.map((f) => (
                <a key={f.name} href={`${base}/files/${encodeURIComponent(f.name)}`} className="btn btn-outline btn-sm" download={f.name}>
                  <DownloadSimple weight="bold" size={14} />
                  {f.name}
                  <span className="muted">· {formatBytes(f.size ?? 0)}</span>
                </a>
              ))}
            </div>
          ) : null}
        </section>
        <div className={styles.columns}>
          <div className={styles.doc}>
            <WorkflowDoc name={share.file.name} bytes={fileBytes(share.file)} source={share.file.content} downloadHref={`${base}/download`}>
              <MarkdownDoc md={share.file.content} />
            </WorkflowDoc>
          </div>
          {toc.length ? (
            <nav className={styles.toc} aria-label="Contents">
              <div className="section-title">Contents</div>
              {toc.map((h, i) => (
                <a key={`${h.id}-${i}`} href={`#${h.id}`} data-depth={h.depth}>
                  {h.text}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
        <footer className={styles.foot}>
          <FileText size={14} />
          Shared with you by Clay. This page is read-only.
        </footer>
      </main>
    </div>
  );
}

function Unavailable() {
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerIn}>
          <ClayLogo className={styles.logo} />
          <span className={styles.label}>Shared by Clay</span>
        </div>
      </header>
      <main className={styles.gone}>
        <div className="slab" style={{ alignItems: "center", textAlign: "center", padding: "48px 32px", gap: 12, maxWidth: 520 }}>
          <h1 className="display-md">This link isn&apos;t available</h1>
          <p className="muted">Ask your Clay contact for a new one.</p>
        </div>
      </main>
    </div>
  );
}
