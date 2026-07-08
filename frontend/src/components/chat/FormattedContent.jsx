import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

// react-markdown always wraps a fenced code block in <pre><code>...</code></pre>,
// with the language on the <code> element's className (e.g. "language-bash") -
// inline `code` never gets that wrapper. Overriding `pre` lets us fully own
// the block's markup (header bar + language label) instead of styling the
// default <pre>; the `code` override below only ever fires for genuine
// inline code since block code is consumed here before React renders it.
function CodeBlock({ children }) {
  const codeElement = Array.isArray(children) ? children[0] : children
  const className = codeElement?.props?.className || ""
  const lang = /language-(\w+)/.exec(className)?.[1] || "text"
  const raw = codeElement?.props?.children
  const text = (Array.isArray(raw) ? raw.join("") : String(raw ?? "")).replace(/\n$/, "")

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {lang}
      </div>
      <pre className="overflow-x-auto bg-card px-3 py-2.5 font-mono text-[13px] text-foreground">
        <code>{text}</code>
      </pre>
    </div>
  )
}

const components = {
  pre: CodeBlock,
  // eslint-disable-next-line no-unused-vars -- destructured only to keep it out of ...props
  code: ({ node, className, children, ...props }) => (
    <code
      className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground", className)}
      {...props}
    >
      {children}
    </code>
  ),
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  // eslint-disable-next-line no-unused-vars -- destructured only to keep it out of ...props
  a: ({ node, children, ...props }) => (
    <a className="text-primary underline underline-offset-2 hover:no-underline" target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-lg font-semibold text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-1.5 text-left font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-border px-3 py-1.5 align-top">{children}</td>,
}

export function FormattedContent({ content }) {
  if (!content) return null

  return (
    <div className="flex flex-col gap-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
