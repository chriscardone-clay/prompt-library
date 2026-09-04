import { ArrowFatUp } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { plural } from "@/lib/format";
import type { PromptNode } from "@/lib/types";
import styles from "./VariantsTree.module.css";

interface Props {
  nodes: PromptNode[];
  currentId: string;
  /** "prompt" or "skill", for the empty-state copy. */
  noun?: string;
}

interface TreeRow {
  node: PromptNode;
  depth: number;
}

/** Walks from the root of the fork lineage down through every visible fork. */
function buildTree(nodes: PromptNode[], currentId: string): TreeRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let root = byId.get(currentId);
  if (!root) return [];
  const seen = new Set<string>([root.id]);
  while (root.parentId && byId.has(root.parentId) && !seen.has(root.parentId)) {
    root = byId.get(root.parentId)!;
    seen.add(root.id);
  }
  const rows: TreeRow[] = [];
  const visited = new Set<string>();
  const walk = (n: PromptNode, depth: number) => {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    rows.push({ node: n, depth });
    nodes
      .filter((c) => c.parentId === n.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  return rows;
}

export function VariantsTree({ nodes, currentId, noun = "prompt" }: Props) {
  const rows = buildTree(nodes, currentId);
  const forks = Math.max(rows.length - 1, 0);

  return (
    <div className="slab" style={{ gap: 16 }}>
      <div className={styles.head}>
        <div className="section-title">Variants</div>
        <div className="tiny muted">{forks ? plural(forks, "fork") : "original"}</div>
      </div>
      {forks ? (
        <div className={styles.list}>
          {rows.map(({ node, depth }) => {
            const isCurrent = node.id === currentId;
            const sub = isCurrent
              ? `${node.owner.name} · this version`
              : node.forkNote
                ? `${node.owner.name} · ${node.forkNote}`
                : `${node.owner.name} · original`;
            return (
              <div
                key={node.id}
                className={styles.row}
                style={{ marginLeft: depth ? (depth - 1) * 22 : 0 }}
              >
                {depth > 0 ? (
                  <div className={styles.connector} aria-hidden="true">
                    <div className={styles.connV} />
                    <div className={styles.connH} />
                  </div>
                ) : null}
                <Link
                  href={`/prompts/${node.id}`}
                  className={styles.node}
                  aria-current={isCurrent ? "page" : undefined}
                >
                  <div className={styles.nodeTop}>
                    <span className={`${styles.nodeTitle} truncate`}>{node.title}</span>
                    <span className={styles.votes}>
                      <ArrowFatUp weight="fill" size={11} />
                      {node.upvotes}
                    </span>
                  </div>
                  <div className={`${styles.nodeSub} truncate`}>{sub}</div>
                </Link>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 14 }}>
          No forks yet. Fork this {noun} to make your own version. It stays linked here.
        </div>
      )}
    </div>
  );
}
