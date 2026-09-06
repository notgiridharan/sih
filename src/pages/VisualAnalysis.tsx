import { useState, useMemo } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { EyeIcon, CodeIcon, ShieldIcon, AlertIcon } from '../components/ui/Icons'
import { analyzeDOM } from '../services/dom-analyzer'
import { getMockHTML } from '../services/capture'
import type { ScanResult, AnalyzedElement, DOMAnalysis, ElementCategory } from '../types/scan'

interface VisualAnalysisProps {
  scanResults: ScanResult[]
  capturedDOM: string | null
}

const CATEGORY_CONFIG: Record<ElementCategory, { label: string; color: string }> = {
  input: { label: 'Input', color: 'var(--orange)' },
  form: { label: 'Form', color: 'var(--orange)' },
  button: { label: 'Button', color: 'var(--accent)' },
  link: { label: 'Link', color: 'var(--cyan)' },
  text: { label: 'Text', color: 'var(--text-secondary)' },
  hidden: { label: 'Hidden', color: 'var(--red)' },
  iframe: { label: 'iFrame', color: 'var(--red)' },
  script: { label: 'Script', color: 'var(--yellow)' },
  interactive: { label: 'Interactive', color: 'var(--accent-hover)' },
  media: { label: 'Media', color: 'var(--cyan)' },
  structural: { label: 'Structural', color: 'var(--text-muted)' },
}

const CLASSIFICATION_CONFIG: Record<string, { label: string; color: string; variant: string }> = {
  safe: { label: 'Safe', color: 'var(--green)', variant: 'none' },
  sensitive: { label: 'Sensitive', color: 'var(--orange)', variant: 'high' },
  suspicious: { label: 'Suspicious', color: 'var(--red)', variant: 'critical' },
  unclassified: { label: 'Unclassified', color: 'var(--text-muted)', variant: 'default' },
}

export function VisualAnalysis({ scanResults, capturedDOM }: VisualAnalysisProps) {
  const hasRealData = scanResults.length > 0 || capturedDOM !== null

  const analysis = useMemo<DOMAnalysis>(() => {
    const source = capturedDOM || getMockHTML()
    return analyzeDOM(source)
  }, [capturedDOM])

  const [selectedElement, setSelectedElement] = useState<AnalyzedElement | null>(null)
  const [filterCategory, setFilterCategory] = useState<ElementCategory | 'all'>('all')

  const filteredCount = filterCategory === 'all'
    ? analysis.flatElements.length
    : analysis.flatElements.filter((e) => e.category === filterCategory).length

  const summaryItems: { key: ElementCategory; label: string; count: number; color: string }[] = [
    { key: 'input', label: 'Inputs', count: analysis.summary.inputs, color: 'var(--orange)' },
    { key: 'form', label: 'Forms', count: analysis.summary.forms, color: 'var(--orange)' },
    { key: 'button', label: 'Buttons', count: analysis.summary.buttons, color: 'var(--accent)' },
    { key: 'link', label: 'Links', count: analysis.summary.links, color: 'var(--cyan)' },
    { key: 'hidden', label: 'Hidden', count: analysis.summary.hidden, color: 'var(--red)' },
    { key: 'iframe', label: 'iFrames', count: analysis.summary.iframes, color: 'var(--red)' },
    { key: 'script', label: 'Scripts', count: analysis.summary.scripts, color: 'var(--yellow)' },
    { key: 'interactive', label: 'Interactive', count: analysis.summary.interactive, color: 'var(--accent-hover)' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
        gap: 8,
      }}>
        {summaryItems.map((s) => (
          <button
            key={s.key}
            onClick={() => setFilterCategory(filterCategory === s.key ? 'all' : s.key)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              padding: '10px 12px',
              background: filterCategory === s.key ? `color-mix(in srgb, ${s.color} 15%, var(--bg-card))` : 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: filterCategory === s.key ? `1px solid ${s.color}` : '1px solid var(--border)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600 }}>
              {s.label}
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, color: s.count > 0 ? s.color : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {s.count}
            </span>
          </button>
        ))}
      </div>

      {/* Main content: tree + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }} className="visual-grid">
        {/* DOM Tree */}
        <Panel
          title="DOM Inspector"
          subtitle={`${filteredCount} elements${filterCategory !== 'all' ? ` (${filterCategory})` : ''} — ${analysis.summary.total} total`}
          action={
            filterCategory !== 'all' && (
              <Button variant="ghost" size="sm" onClick={() => setFilterCategory('all')}>
                Clear Filter
              </Button>
            )
          }
        >
          <div style={{
            maxHeight: 520,
            overflow: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-input)',
            padding: '8px 0',
          }}>
            <AnalyzedTreeNode
              node={analysis.tree}
              selected={selectedElement}
              onSelect={setSelectedElement}
              filter={filterCategory}
            />
          </div>
        </Panel>

        {/* Element Detail */}
        <Panel title="Element Details" subtitle={selectedElement ? `<${selectedElement.tag}>` : 'Select an element'}>
          {selectedElement ? (
            <ElementDetailView element={selectedElement} />
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 300,
              gap: 12,
              color: 'var(--text-muted)',
            }}>
              <EyeIcon size={40} />
              <p style={{ fontSize: 13, textAlign: 'center' }}>Click on any element in the tree to inspect it</p>
              <p style={{ fontSize: 11, textAlign: 'center', maxWidth: 220 }}>
                View element type, selector, attributes, visibility, text content, and classification status
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* Suspicious elements */}
      <SuspiciousElementsList elements={analysis.flatElements} onSelect={setSelectedElement} />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Badge variant="info" dot>Modular Analyzer</Badge>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            DOM analysis output is consumed by the Privacy Scanner and Injection Scanner for automated threat detection.
            {!hasRealData && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>(showing demo data)</span>}
          </p>
        </div>
      </Card>
    </div>
  )
}

/* ─── Analyzed Tree Node ──────────────────────────────────────── */

function AnalyzedTreeNode({
  node,
  selected,
  onSelect,
  filter,
}: {
  node: AnalyzedElement
  selected: AnalyzedElement | null
  onSelect: (el: AnalyzedElement) => void
  filter: ElementCategory | 'all'
}) {
  const [expanded, setExpanded] = useState(node.depth < 2)
  const hasChildren = node.children.length > 0
  const indent = node.depth * 18

  const matchesFilter = filter === 'all' || node.category === filter
  const hasMatchingDescendant = filter === 'all' || hasDescendant(node, filter)

  if (!matchesFilter && !hasMatchingDescendant) return null

  const isSelected = selected?.index === node.index
  const catConfig = CATEGORY_CONFIG[node.category]
  const classConfig = CLASSIFICATION_CONFIG[node.classification]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 12px 3px',
          paddingLeft: 12 + indent,
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'var(--mono)',
          lineHeight: 1.7,
          background: isSelected ? 'var(--accent-muted)' : 'transparent',
          borderLeft: isSelected ? `2px solid var(--accent)` : '2px solid transparent',
          opacity: matchesFilter ? 1 : 0.4,
          transition: 'background 0.1s',
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(node)
        }}
        onDoubleClick={() => hasChildren && setExpanded(!expanded)}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'var(--bg-card-hover)'
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent'
        }}
      >
        {/* Expand toggle */}
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
            style={{
              color: 'var(--text-muted)',
              fontSize: 10,
              width: 14,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.15s',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              flexShrink: 0,
              cursor: 'pointer',
            }}
          >
            &#9654;
          </span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}

        {/* Tag name */}
        <span style={{ color: 'var(--text-muted)' }}>&lt;</span>
        <span style={{ color: catConfig.color, fontWeight: 600 }}>{node.tag}</span>

        {/* id */}
        {node.id && (
          <>
            <span style={{ color: 'var(--yellow)' }}> id</span>
            <span style={{ color: 'var(--text-muted)' }}>=</span>
            <span style={{ color: 'var(--green)' }}>"{node.id}"</span>
          </>
        )}

        {/* classes (abbreviated) */}
        {node.classes.length > 0 && (
          <>
            <span style={{ color: 'var(--yellow)' }}> class</span>
            <span style={{ color: 'var(--text-muted)' }}>=</span>
            <span style={{ color: 'var(--green)' }}>"{node.classes.slice(0, 2).join(' ')}{node.classes.length > 2 ? '...' : ''}"</span>
          </>
        )}

        <span style={{ color: 'var(--text-muted)' }}>&gt;</span>

        {/* Category badge */}
        <span style={{
          marginLeft: 6,
          fontSize: 9,
          padding: '1px 5px',
          borderRadius: 3,
          background: `color-mix(in srgb, ${catConfig.color} 15%, transparent)`,
          color: catConfig.color,
          fontWeight: 600,
          fontFamily: 'var(--sans)',
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}>
          {catConfig.label}
        </span>

        {/* Classification indicator */}
        {node.classification !== 'safe' && node.classification !== 'unclassified' && (
          <span style={{
            marginLeft: 4,
            fontSize: 9,
            padding: '1px 5px',
            borderRadius: 3,
            background: `color-mix(in srgb, ${classConfig.color} 15%, transparent)`,
            color: classConfig.color,
            fontWeight: 700,
            fontFamily: 'var(--sans)',
          }}>
            {classConfig.label.toUpperCase()}
          </span>
        )}

        {/* Collapsed child count */}
        {!expanded && hasChildren && (
          <span style={{
            marginLeft: 4,
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--sans)',
          }}>
            {node.children.length} children
          </span>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <AnalyzedTreeNode
              key={child.index}
              node={child}
              selected={selected}
              onSelect={onSelect}
              filter={filter}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function hasDescendant(node: AnalyzedElement, category: ElementCategory): boolean {
  for (const child of node.children) {
    if (child.category === category || hasDescendant(child, category)) return true
  }
  return false
}

/* ─── Element Detail View ─────────────────────────────────────── */

function ElementDetailView({ element }: { element: AnalyzedElement }) {
  const catConfig = CATEGORY_CONFIG[element.category]
  const classConfig = CLASSIFICATION_CONFIG[element.classification]

  const attrEntries = Object.entries(element.attributes).filter(
    ([k]) => k !== 'class' && k !== 'id' && k !== 'style'
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius)',
        borderLeft: `3px solid ${catConfig.color}`,
      }}>
        <CodeIcon size={18} />
        <code style={{ fontSize: 15, fontWeight: 700, color: catConfig.color, fontFamily: 'var(--mono)' }}>
          &lt;{element.tag}&gt;
        </code>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Badge variant={classConfig.variant as 'none' | 'default' | 'critical' | 'high'}>
            {classConfig.label}
          </Badge>
        </div>
      </div>

      {/* Properties grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <DetailRow label="Element Type" value={element.tag} />
        <DetailRow label="Category" value={catConfig.label} valueColor={catConfig.color} />
        <DetailRow label="Selector" value={element.selector} mono />
        <DetailRow label="Visibility" value={element.visible ? 'Visible' : 'Hidden'} valueColor={element.visible ? 'var(--green)' : 'var(--red)'} />
        <DetailRow label="Classification" value={classConfig.label} valueColor={classConfig.color} />
        <DetailRow label="Depth" value={String(element.depth)} />
        <DetailRow label="Children" value={String(element.children.length)} />
      </div>

      {/* ID & Classes */}
      {(element.id || element.classes.length > 0) && (
        <div style={{
          padding: '10px 12px',
          background: 'var(--bg-input)',
          borderRadius: 'var(--radius)',
        }}>
          {element.id && (
            <div style={{ marginBottom: element.classes.length > 0 ? 8 : 0 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ID</span>
              <code style={{ display: 'block', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--cyan)', marginTop: 3 }}>
                #{element.id}
              </code>
            </div>
          )}
          {element.classes.length > 0 && (
            <div>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Classes</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {element.classes.map((cls) => (
                  <code key={cls} style={{
                    fontSize: 11,
                    fontFamily: 'var(--mono)',
                    padding: '2px 6px',
                    background: 'var(--bg-card)',
                    borderRadius: 3,
                    color: 'var(--accent-hover)',
                  }}>
                    .{cls}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Attributes */}
      {attrEntries.length > 0 && (
        <div>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' }}>
            Attributes
          </span>
          <div style={{
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
          }}>
            {attrEntries.map(([key, val]) => (
              <div key={key} style={{
                display: 'flex',
                gap: 8,
                padding: '6px 12px',
                borderBottom: '1px solid var(--border)',
                fontSize: 12,
                fontFamily: 'var(--mono)',
              }}>
                <span style={{ color: 'var(--yellow)', minWidth: 80, flexShrink: 0 }}>{key}</span>
                <span style={{ color: 'var(--green)', wordBreak: 'break-all' }}>{val || '(empty)'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inline style */}
      {element.attributes.style && (
        <div>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' }}>
            Inline Style
          </span>
          <pre style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            background: 'var(--bg-input)',
            padding: 10,
            borderRadius: 'var(--radius)',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {element.attributes.style}
          </pre>
        </div>
      )}

      {/* Text content */}
      {element.textContent && (
        <div>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'block' }}>
            Text Content
          </span>
          <div style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            color: element.classification === 'suspicious' ? 'var(--red)' : 'var(--text-primary)',
            background: element.classification === 'suspicious' ? 'var(--red-muted)' : 'var(--bg-input)',
            padding: '8px 12px',
            borderRadius: 'var(--radius)',
            wordBreak: 'break-word',
            maxHeight: 120,
            overflow: 'auto',
          }}>
            {element.textContent}
          </div>
        </div>
      )}

      {/* Bounding box placeholder */}
      <div style={{
        padding: '8px 12px',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius)',
        fontSize: 11,
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <EyeIcon size={12} />
        Bounding box: {element.boundingBox
          ? `${element.boundingBox.x}, ${element.boundingBox.y} — ${element.boundingBox.width}×${element.boundingBox.height}`
          : 'Available with live DOM capture'}
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  valueColor,
  mono,
}: {
  label: string
  value: string
  valueColor?: string
  mono?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '5px 0',
      borderBottom: '1px solid var(--border)',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{
        color: valueColor || 'var(--text-primary)',
        fontFamily: mono ? 'var(--mono)' : 'inherit',
        fontSize: mono ? 11 : 12,
        fontWeight: 500,
      }}>
        {value}
      </span>
    </div>
  )
}

/* ─── Suspicious Elements List ────────────────────────────────── */

function SuspiciousElementsList({
  elements,
  onSelect,
}: {
  elements: AnalyzedElement[]
  onSelect: (el: AnalyzedElement) => void
}) {
  const suspicious = elements.filter((e) => e.classification === 'suspicious' || e.classification === 'sensitive')

  if (suspicious.length === 0) return null

  return (
    <Panel
      title="Flagged Elements"
      subtitle={`${suspicious.length} elements require attention`}
      noPadding
    >
      <div>
        {suspicious.map((el) => {
          const catConfig = CATEGORY_CONFIG[el.category]
          const classConfig = CLASSIFICATION_CONFIG[el.classification]

          return (
            <div
              key={el.index}
              onClick={() => onSelect(el)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 20px',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {el.classification === 'suspicious' ? (
                <AlertIcon size={16} />
              ) : (
                <ShieldIcon size={16} />
              )}

              <code style={{
                fontSize: 12,
                fontFamily: 'var(--mono)',
                color: catConfig.color,
              }}>
                &lt;{el.tag}&gt;
              </code>

              <code style={{
                fontSize: 11,
                fontFamily: 'var(--mono)',
                color: 'var(--text-muted)',
              }}>
                {el.selector}
              </code>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <Badge variant={classConfig.variant as 'none' | 'default' | 'critical' | 'high'}>
                  {classConfig.label}
                </Badge>
                {!el.visible && (
                  <Badge variant="medium">Hidden</Badge>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
