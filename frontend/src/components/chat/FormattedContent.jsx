import { Fragment } from "react"

function renderInline(text, keyPrefix) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return (
        <code
          key={`${keyPrefix}-${i}`}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
  })
}

// Splits assistant/user text on fenced ``` code blocks and renders the rest as
// paragraphs with inline `code` spans, without pulling in a full markdown parser.
export function FormattedContent({ content }) {
  if (!content) return null

  const segments = content.split(/```(\w*)\n?([\s\S]*?)```/g)
  const nodes = []

  for (let i = 0; i < segments.length; i += 3) {
    const text = segments[i]
    const lang = segments[i + 1]
    const code = segments[i + 2]

    if (text) {
      text
        .split(/\n{2,}/)
        .filter(Boolean)
        .forEach((para, pi) => {
          nodes.push(
            <p key={`t-${i}-${pi}`} className="whitespace-pre-wrap leading-relaxed">
              {renderInline(para, `t-${i}-${pi}`)}
            </p>
          )
        })
    }

    if (code !== undefined) {
      nodes.push(
        <div key={`c-${i}`} className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {lang || "code"}
          </div>
          <pre className="overflow-x-auto bg-card px-3 py-2.5 font-mono text-[13px] text-foreground">
            <code>{code.replace(/\n$/, "")}</code>
          </pre>
        </div>
      )
    }
  }

  return <div className="flex flex-col gap-3">{nodes}</div>
}
