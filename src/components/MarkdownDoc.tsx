import type { ComponentProps } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownDoc.module.css";

/**
 * A workflow's .md, rendered on the server. GitHub-flavoured (tables, task
 * lists), headings get ids for the contents list, raw HTML is never rendered,
 * external links open in a new tab without a referrer, and images show as a
 * link to the image instead of loading it.
 */
export function MarkdownDoc({ md }: { md: string }) {
  return (
    <div className={styles.md}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        skipHtml
        urlTransform={defaultUrlTransform}
        components={{
          a: Anchor,
          img: Img,
          table: ({ node: _node, ...props }) => (
            <div className={styles.scroll}>
              <table {...props} />
            </div>
          ),
          pre: ({ node: _node, ...props }) => (
            <div className={styles.scroll}>
              <pre {...props} />
            </div>
          ),
        }}
      >
        {md}
      </Markdown>
    </div>
  );
}

function Anchor({ node: _node, href, children, ...rest }: ComponentProps<"a"> & { node?: unknown }) {
  const external = !!href && /^https?:/i.test(href);
  return (
    <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
      {children}
    </a>
  );
}

function Img({ src, alt }: ComponentProps<"img"> & { node?: unknown }) {
  const url = typeof src === "string" ? src : "";
  if (!url) return <span>{alt}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow">
      {alt || "Image"}
    </a>
  );
}
