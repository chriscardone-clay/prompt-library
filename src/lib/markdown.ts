import "server-only";
import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface TocEntry {
  depth: number;
  text: string;
  id: string;
}

interface MdNode {
  type: string;
  depth?: number;
  children?: MdNode[];
}

/**
 * H2/H3 headings of a doc with the ids rehype-slug gives them: one slugger,
 * every heading in document order (H1 and H4+ included so duplicates number
 * the same way), text taken from the parsed tree like rehype-slug does.
 */
export function tableOfContents(md: string): TocEntry[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as MdNode;
  const slugger = new GithubSlugger();
  const out: TocEntry[] = [];
  const walk = (n: MdNode) => {
    if (n.type === "heading") {
      const text = toString(n).trim();
      const id = slugger.slug(text);
      if ((n.depth === 2 || n.depth === 3) && text) out.push({ depth: n.depth, text, id });
      return;
    }
    n.children?.forEach(walk);
  };
  walk(tree);
  return out;
}
