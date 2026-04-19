'use client'

import React, { useEffect, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// ── KaTeX ─────────────────────────────────────────────────────

function renderMath(tex: string, display: boolean): React.ReactNode {
  try {
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' })
    return <span dangerouslySetInnerHTML={{ __html: html }} style={display ? { display: 'block', textAlign: 'center', overflowX: 'auto', margin: '4px 0' } : undefined} />
  } catch {
    return <span>{display ? `$$${tex}$$` : `$${tex}$`}</span>
  }
}

// ── Mermaid ───────────────────────────────────────────────────

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState(false)
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    let cancelled = false
    import('mermaid').then(async (m) => {
      m.default.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', fontFamily: 'inherit' })
      try {
        const { svg: rendered } = await m.default.render(idRef.current, code.trim())
        if (!cancelled) setSvg(rendered)
      } catch {
        if (!cancelled) setError(true)
      }
    })
    return () => { cancelled = true }
  }, [code])

  if (error) return (
    <pre style={{ fontSize: '0.78em', opacity: 0.55, whiteSpace: 'pre-wrap', background: 'rgba(55,53,47,0.05)', borderRadius: 4, padding: '6px 8px' }}>
      {code}
    </pre>
  )
  if (!svg) return <div style={{ fontSize: '0.75em', opacity: 0.4, padding: '4px 0' }}>Rendering diagram…</div>
  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ overflowX: 'auto', maxWidth: '100%', margin: '4px 0' }}
    />
  )
}

// ── Inline styles: bold, inline-code, inline math ─────────────

export function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\*\*(.+?)\*\*|`(.+?)`)/g
  let last = 0; let key = 0; let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>)
    const tok = m[0]
    if (tok.startsWith('$$'))      parts.push(<span key={key++}>{renderMath(tok.slice(2, -2).trim(), true)}</span>)
    else if (tok.startsWith('$')) parts.push(<span key={key++}>{renderMath(tok.slice(1, -1).trim(), false)}</span>)
    else if (tok.startsWith('**')) parts.push(<strong key={key++}>{m[2]}</strong>)
    else parts.push(<code key={key++} style={{ background: 'rgba(55,53,47,0.08)', borderRadius: 3, padding: '0 3px', fontFamily: 'monospace', fontSize: '0.9em' }}>{m[3]}</code>)
    last = m.index + tok.length
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>)
  return <>{parts}</>
}

// ── Table ─────────────────────────────────────────────────────

function renderTable(rows: string[], key: number): React.ReactNode {
  const dataRows = rows.filter(r => !/^\|[\s\-:|]+\|$/.test(r.trim()))
  return (
    <div key={key} style={{ overflowX: 'auto', margin: '6px 0' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.82em', width: '100%' }}>
        <tbody>
          {dataRows.map((row, ri) => {
            const cells = row.split('|').slice(1, -1)
            return (
              <tr key={ri}>
                {cells.map((cell, ci) =>
                  ri === 0
                    ? <th key={ci} style={{ border: '1px solid rgba(55,53,47,0.2)', padding: '4px 8px', fontWeight: 600, textAlign: 'left', background: 'rgba(55,53,47,0.04)' }}>{renderInline(cell.trim())}</th>
                    : <td key={ci} style={{ border: '1px solid rgba(55,53,47,0.2)', padding: '4px 8px' }}>{renderInline(cell.trim())}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Main renderer ─────────────────────────────────────────────

export function renderNote(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = []
  const lines = text.split('\n')
  let i = 0; let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code / mermaid block
    const fenceMatch = line.trim().match(/^```(\w*)$/)
    if (fenceMatch) {
      const lang = fenceMatch[1].toLowerCase()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing fence
      const code = codeLines.join('\n')
      if (lang === 'mermaid') {
        nodes.push(<MermaidDiagram key={key++} code={code} />)
      } else {
        nodes.push(
          <pre key={key++} style={{ background: 'rgba(55,53,47,0.06)', borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.82em', overflowX: 'auto', margin: '4px 0', whiteSpace: 'pre' }}>
            {lang && <div style={{ opacity: 0.4, fontSize: '0.78em', marginBottom: 2 }}>{lang}</div>}
            <code>{code}</code>
          </pre>
        )
      }
      continue
    }

    // Table
    if (line.startsWith('|')) {
      const tableRows: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) { tableRows.push(lines[i]); i++ }
      nodes.push(renderTable(tableRows, key++))
      continue
    }

    // Heading
    const hMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (hMatch) {
      const lvl = hMatch[1].length
      const sz = lvl === 1 ? '1.1em' : lvl === 2 ? '1.0em' : '0.95em'
      nodes.push(<div key={key++} style={{ fontWeight: 700, fontSize: sz, marginTop: lvl === 1 ? 8 : 4, marginBottom: 2 }}>{renderInline(hMatch[2])}</div>)
      i++; continue
    }

    // Bullet
    if (/^[\s]*[-*•]\s/.test(line)) {
      nodes.push(
        <div key={key++} style={{ display: 'flex', gap: 4, paddingLeft: 8 }}>
          <span style={{ opacity: 0.45, flexShrink: 0 }}>•</span>
          <span>{renderInline(line.replace(/^[\s]*[-*•]\s/, ''))}</span>
        </div>
      )
      i++; continue
    }

    // Blank line
    if (line.trim() === '') { nodes.push(<div key={key++} style={{ height: 4 }} />); i++; continue }

    // Normal line
    nodes.push(<div key={key++}>{renderInline(line)}</div>)
    i++
  }

  return <>{nodes}</>
}
