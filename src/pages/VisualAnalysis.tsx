import { useState, useMemo } from 'react'
import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { EyeIcon, CodeIcon, ShieldIcon, AlertIcon, CheckCircleIcon } from '../components/ui/Icons'
import { analyzeDOM } from '../services/dom-analyzer'
import { getMockHTML } from '../services/capture'
import type { ScanResult, AnalyzedElement, DOMAnalysis, ElementCategory, RiskLevel, OCRStatus, CorrelationSeverity, CorrelationFinding, RiskCategory, SecurityFinding, EvidenceItem } from '../types/scan'
import { aggregateFindings } from '../services/findings'
import { generateReport, downloadReport } from '../services/report'

interface VisualAnalysisProps {
  scanResults: ScanResult[]
  capturedDOM: string | null
  viewingScan?: ScanResult | null
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

export function VisualAnalysis({ scanResults, capturedDOM, viewingScan }: VisualAnalysisProps) {
  const hasRealData = scanResults.length > 0 || capturedDOM !== null
  const isHistorical = viewingScan != null

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
      {/* Historical scan indicator */}
      {isHistorical && viewingScan && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderRadius: 'var(--radius)',
          background: 'var(--accent-muted)',
          border: '1px solid var(--accent-border)',
        }}>
          <Badge variant="info" dot>Historical Scan</Badge>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Scanned {new Date(viewingScan.timestamp).toLocaleString()} — {viewingScan.url}
          </span>
        </div>
      )}

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

      {/* Cross-Validation Results */}
      <CrossValidationPanel scanResults={scanResults} />

      {/* Local Visual Analysis (OCR) */}
      <OCRResultsPanel scanResults={scanResults} />

      {/* Cross-Modal Correlations */}
      <CorrelationPanel scanResults={scanResults} />

      {/* Unified Risk Assessment */}
      <RiskAssessmentPanel scanResults={scanResults} />

      {/* Security Findings with Evidence */}
      <SecurityFindingsPanel scanResults={scanResults} />

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

/* ─── Cross-Validation Panel ─────────────────────────────────── */

const SEVERITY_COLOR: Record<RiskLevel, string> = {
  none: 'var(--text-muted)',
  low: 'var(--green)',
  medium: 'var(--yellow)',
  high: 'var(--orange)',
  critical: 'var(--red)',
}

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  HIDDEN_AGENT_INSTRUCTION: 'Hidden Agent Instruction',
  INVISIBLE_PROMPT_INJECTION: 'Invisible Prompt Injection',
  OFFSCREEN_SUSPICIOUS_CONTENT: 'Off-screen Suspicious Content',
  DOM_VISIBILITY_MISMATCH: 'DOM Visibility Mismatch',
  HIDDEN_INTERACTIVE_ELEMENT: 'Hidden Interactive Element',
  CLOAKED_CONTENT: 'Cloaked Content',
}

function CrossValidationPanel({ scanResults }: { scanResults: ScanResult[] }) {
  const latestCV = scanResults.length > 0 ? scanResults[0].crossValidation : null
  const latestRisk = scanResults.length > 0 ? scanResults[0].risk : null

  return (
    <Panel
      title="DOM / Visual Cross-Validation"
      subtitle="Correlates DOM analysis with visual state to detect hidden threats"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status indicators */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatusChip
            label="DOM captured"
            active={scanResults.length > 0}
          />
          <StatusChip
            label="Screenshot captured"
            active={latestCV?.hasScreenshot ?? false}
          />
          <StatusChip
            label="Cross-validation run"
            active={latestCV != null}
          />
        </div>

        {/* Risk scores */}
        {latestRisk && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 8,
          }}>
            <RiskBar label="Privacy Risk" score={latestRisk.privacy} />
            <RiskBar label="Injection Risk" score={latestRisk.injection} />
            <RiskBar label="Hidden Content Risk" score={latestRisk.hidden} />
            <RiskBar label="Visual/DOM Anomaly Risk" score={latestRisk.visualAnomaly} />
            <div style={{
              gridColumn: '1 / -1',
              padding: '8px 14px',
              background: `color-mix(in srgb, ${SEVERITY_COLOR[latestRisk.overall]} 10%, var(--bg-input))`,
              border: `1px solid ${SEVERITY_COLOR[latestRisk.overall]}`,
              borderRadius: 'var(--radius)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Overall Risk</span>
              <Badge variant={latestRisk.overall}>{latestRisk.overall.toUpperCase()}</Badge>
            </div>
          </div>
        )}

        {/* Anomalies */}
        {latestCV && latestCV.anomalies.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
              Detected Anomalies ({latestCV.anomalies.length})
            </span>
            {latestCV.anomalies.map((anomaly, i) => (
              <div key={i} style={{
                padding: '10px 14px',
                background: 'var(--bg-input)',
                borderRadius: 'var(--radius)',
                borderLeft: `3px solid ${SEVERITY_COLOR[anomaly.severity]}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge variant={anomaly.severity}>{anomaly.severity}</Badge>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: SEVERITY_COLOR[anomaly.severity],
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}>
                    {ANOMALY_TYPE_LABELS[anomaly.type] || anomaly.type}
                  </span>
                  {anomaly.technique && (
                    <code style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 3,
                      background: 'var(--bg-card)',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--mono)',
                    }}>
                      {anomaly.technique}
                    </code>
                  )}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  {anomaly.reason}
                </p>
                <code style={{
                  fontSize: 11,
                  fontFamily: 'var(--mono)',
                  color: 'var(--text-muted)',
                  padding: '4px 8px',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius)',
                  wordBreak: 'break-all',
                  maxHeight: 60,
                  overflow: 'auto',
                }}>
                  {anomaly.content.slice(0, 200)}{anomaly.content.length > 200 ? '...' : ''}
                </code>
              </div>
            ))}
          </div>
        ) : latestCV ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            background: 'color-mix(in srgb, var(--green) 8%, var(--bg-input))',
            borderRadius: 'var(--radius)',
            border: '1px solid color-mix(in srgb, var(--green) 25%, var(--border))',
          }}>
            <CheckCircleIcon size={16} />
            <span style={{ fontSize: 13, color: 'var(--green)' }}>No DOM/visual anomalies detected</span>
          </div>
        ) : (
          <div style={{
            padding: '20px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            Run a scan from Browser Capture to see cross-validation results
          </div>
        )}
      </div>
    </Panel>
  )
}

function StatusChip({ label, active }: { label: string; active: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      borderRadius: 'var(--radius)',
      background: active
        ? 'color-mix(in srgb, var(--green) 10%, var(--bg-input))'
        : 'var(--bg-input)',
      border: `1px solid ${active ? 'color-mix(in srgb, var(--green) 30%, var(--border))' : 'var(--border)'}`,
      fontSize: 12,
      color: active ? 'var(--green)' : 'var(--text-muted)',
    }}>
      <span style={{ fontSize: 14 }}>{active ? '✓' : '–'}</span>
      {label}
    </div>
  )
}

function RiskBar({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'var(--red)' : score >= 60 ? 'var(--orange)' : score >= 30 ? 'var(--yellow)' : 'var(--green)'
  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--bg-input)',
      borderRadius: 'var(--radius)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
      </div>
      <div style={{
        height: 3,
        borderRadius: 2,
        background: 'var(--border)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(score, 100)}%`,
          height: '100%',
          background: color,
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  )
}

/* ─── OCR Results Panel ──────────────────────────────────────── */

const OCR_STATUS_CONFIG: Record<OCRStatus, { label: string; color: string }> = {
  idle: { label: 'Idle', color: 'var(--text-muted)' },
  loading: { label: 'Loading OCR Engine', color: 'var(--accent)' },
  processing: { label: 'Processing', color: 'var(--orange)' },
  complete: { label: 'Complete', color: 'var(--green)' },
  error: { label: 'Error', color: 'var(--red)' },
  skipped: { label: 'Skipped', color: 'var(--text-muted)' },
}

function OCRResultsPanel({ scanResults }: { scanResults: ScanResult[] }) {
  const ocr = scanResults.length > 0 ? scanResults[0].ocrResult : null
  const [showAllBlocks, setShowAllBlocks] = useState(false)

  const statusConfig = ocr ? OCR_STATUS_CONFIG[ocr.status] : OCR_STATUS_CONFIG.idle

  return (
    <Panel
      title="Local Visual Analysis"
      subtitle="OCR text extraction from screenshot — processed entirely in-browser"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Status row */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusChip label="OCR Engine" active={ocr?.status === 'complete'} />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: statusConfig.color,
            fontWeight: 500,
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: statusConfig.color,
              display: 'inline-block',
            }} />
            {statusConfig.label}
          </div>
          {ocr?.processingTimeMs != null && ocr.processingTimeMs > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {ocr.processingTimeMs}ms
            </span>
          )}
        </div>

        {ocr?.status === 'complete' && ocr.blocks.length > 0 ? (
          <>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <div style={{ padding: '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius)' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 2 }}>
                  Text Blocks
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {ocr.blocks.length}
                </span>
              </div>
              <div style={{ padding: '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius)' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 2 }}>
                  Confidence
                </span>
                <span style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: ocr.confidence >= 0.8 ? 'var(--green)' : ocr.confidence >= 0.5 ? 'var(--yellow)' : 'var(--red)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {(ocr.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div style={{ padding: '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius)' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, display: 'block', marginBottom: 2 }}>
                  Characters
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {ocr.text.length}
                </span>
              </div>
            </div>

            {/* Extracted text */}
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>
                Extracted Text
              </span>
              <pre style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--text-secondary)',
                background: 'var(--bg-input)',
                padding: '10px 12px',
                borderRadius: 'var(--radius)',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 200,
                overflow: 'auto',
                border: '1px solid var(--border)',
              }}>
                {ocr.text || '(no text extracted)'}
              </pre>
            </div>

            {/* Blocks with bounding boxes */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Detected Blocks ({ocr.blocks.length})
                </span>
                {ocr.blocks.length > 10 && (
                  <Button variant="ghost" size="sm" onClick={() => setShowAllBlocks(!showAllBlocks)}>
                    {showAllBlocks ? 'Show Less' : `Show All (${ocr.blocks.length})`}
                  </Button>
                )}
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                maxHeight: showAllBlocks ? 'none' : 300,
                overflow: showAllBlocks ? 'visible' : 'auto',
              }}>
                {(showAllBlocks ? ocr.blocks : ocr.blocks.slice(0, 20)).map((block, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    background: 'var(--bg-input)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                  }}>
                    <code style={{
                      fontFamily: 'var(--mono)',
                      color: 'var(--text-primary)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {block.text}
                    </code>
                    <span style={{
                      fontSize: 10,
                      color: block.confidence >= 0.8 ? 'var(--green)' : block.confidence >= 0.5 ? 'var(--yellow)' : 'var(--red)',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}>
                      {(block.confidence * 100).toFixed(0)}%
                    </span>
                    <span style={{
                      fontSize: 9,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--mono)',
                      flexShrink: 0,
                    }}>
                      {block.boundingBox.x},{block.boundingBox.y} {block.boundingBox.width}x{block.boundingBox.height}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : ocr?.status === 'complete' ? (
          <div style={{
            padding: '12px 16px',
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}>
            No text detected in screenshot
          </div>
        ) : ocr?.status === 'error' ? (
          <div style={{
            padding: '10px 14px',
            background: 'color-mix(in srgb, var(--red) 8%, var(--bg-input))',
            border: '1px solid color-mix(in srgb, var(--red) 25%, var(--border))',
            borderRadius: 'var(--radius)',
            fontSize: 12,
            color: 'var(--red)',
          }}>
            OCR failed: {ocr.error || 'Unknown error'}. DOM-based analysis was not affected.
          </div>
        ) : ocr?.status === 'skipped' ? (
          <div style={{
            padding: '12px 16px',
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}>
            No screenshot available — OCR requires a captured screenshot. Use the Chrome extension for live tab capture.
          </div>
        ) : (
          <div style={{
            padding: '20px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            Run a scan from Browser Capture to see OCR results
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ─── Correlation Panel ─────────────────────────────────────── */

const CORRELATION_TYPE_LABELS: Record<string, string> = {
  VISUAL_PII_REQUEST: 'Visual PII Request',
  VISUAL_CREDENTIAL_REQUEST: 'Visual Credential Request',
  VISUAL_OTP_REQUEST: 'Visual OTP Request',
  VISUAL_PAYMENT_REQUEST: 'Visual Payment Request',
  CROSS_MODAL_INJECTION: 'Cross-Modal Injection',
  VISUAL_DOM_MISMATCH: 'Visual/DOM Mismatch',
  HIDDEN_CONTENT_MISMATCH: 'Hidden Content Mismatch',
}

const CORRELATION_SEVERITY_COLOR: Record<CorrelationSeverity | 'none', string> = {
  none: 'var(--text-muted)',
  low: 'var(--green)',
  medium: 'var(--yellow)',
  high: 'var(--orange)',
  critical: 'var(--red)',
}

function CorrelationPanel({ scanResults }: { scanResults: ScanResult[] }) {
  const corr = scanResults.length > 0 ? scanResults[0].correlationResult : null
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  return (
    <Panel
      title="Cross-Modal Correlations"
      subtitle="Matches between visual (OCR) and DOM-detected security signals"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {corr && corr.findings.length > 0 ? (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <StatusChip label="Correlation Engine" active />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {corr.totalCorrelations} correlation{corr.totalCorrelations !== 1 ? 's' : ''} found
              </span>
              <Badge variant={corr.highestSeverity as 'none' | 'low' | 'medium' | 'high' | 'critical'}>
                {(corr.highestSeverity || 'none').toUpperCase()}
              </Badge>
            </div>

            {corr.findings.map((finding, i) => (
              <CorrelationCard
                key={i}
                finding={finding}
                expanded={expandedIndex === i}
                onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
              />
            ))}
          </>
        ) : corr ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            background: 'color-mix(in srgb, var(--green) 8%, var(--bg-input))',
            borderRadius: 'var(--radius)',
            border: '1px solid color-mix(in srgb, var(--green) 25%, var(--border))',
          }}>
            <CheckCircleIcon size={16} />
            <span style={{ fontSize: 13, color: 'var(--green)' }}>No cross-modal correlations detected</span>
          </div>
        ) : (
          <div style={{
            padding: '20px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            Run a scan with OCR enabled to see cross-modal correlations
          </div>
        )}
      </div>
    </Panel>
  )
}

function CorrelationCard({
  finding,
  expanded,
  onToggle,
}: {
  finding: CorrelationFinding
  expanded: boolean
  onToggle: () => void
}) {
  const sevColor = CORRELATION_SEVERITY_COLOR[finding.severity]

  return (
    <div style={{
      background: 'var(--bg-input)',
      borderRadius: 'var(--radius)',
      borderLeft: `3px solid ${sevColor}`,
      overflow: 'hidden',
    }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
      >
        <Badge variant={finding.severity as 'none' | 'low' | 'medium' | 'high' | 'critical'}>
          {finding.severity.toUpperCase()}
        </Badge>
        <span style={{
          fontSize: 12,
          fontWeight: 700,
          color: sevColor,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          flex: 1,
        }}>
          {CORRELATION_TYPE_LABELS[finding.type] || finding.type}
        </span>
        <span style={{
          fontSize: 11,
          color: finding.confidence >= 0.8 ? 'var(--green)' : finding.confidence >= 0.5 ? 'var(--yellow)' : 'var(--text-muted)',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {(finding.confidence * 100).toFixed(0)}%
        </span>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>
          ▼
        </span>
      </div>

      <p style={{
        fontSize: 12,
        color: 'var(--text-secondary)',
        margin: 0,
        padding: '0 14px 10px',
        lineHeight: 1.5,
      }}>
        {finding.explanation}
      </p>

      {expanded && (
        <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {finding.evidence.visual && (
            <div style={{
              padding: '8px 12px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                Visual Evidence
              </span>
              <code style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--cyan)', display: 'block' }}>
                "{finding.evidence.visual.ocrText}"
              </code>
              <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>OCR confidence: {(finding.evidence.visual.ocrConfidence * 100).toFixed(0)}%</span>
                {finding.evidence.visual.boundingBox && (
                  <span style={{ fontFamily: 'var(--mono)' }}>
                    bbox: {finding.evidence.visual.boundingBox.x},{finding.evidence.visual.boundingBox.y} {finding.evidence.visual.boundingBox.width}x{finding.evidence.visual.boundingBox.height}
                  </span>
                )}
              </div>
            </div>
          )}

          {finding.evidence.dom && (
            <div style={{
              padding: '8px 12px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                DOM Evidence
              </span>
              <code style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--orange)', display: 'block' }}>
                &lt;{finding.evidence.dom.element}&gt;
              </code>
              <code style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                {finding.evidence.dom.selector}
              </code>
              {finding.evidence.dom.matchedText && (
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginTop: 4 }}>
                  {finding.evidence.dom.matchedText}
                </span>
              )}
              {finding.evidence.dom.attributes && Object.keys(finding.evidence.dom.attributes).length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  {Object.entries(finding.evidence.dom.attributes).map(([k, v]) => (
                    <code key={k} style={{
                      fontSize: 10,
                      fontFamily: 'var(--mono)',
                      padding: '1px 5px',
                      background: 'var(--bg-input)',
                      borderRadius: 3,
                      color: 'var(--text-muted)',
                    }}>
                      {k}="{v}"
                    </code>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const RISK_LEVEL_COLOR: Record<string, string> = {
  none: 'var(--green)',
  low: 'var(--cyan)',
  medium: 'var(--yellow)',
  high: 'var(--orange)',
  critical: 'var(--red)',
}

const CATEGORY_LABELS: Record<RiskCategory, string> = {
  privacy: 'Privacy',
  injection: 'Injection',
  deception: 'Deception',
  overall: 'Overall',
}

function RiskAssessmentPanel({ scanResults }: { scanResults: ScanResult[] }) {
  const latest = scanResults[scanResults.length - 1] ?? null
  const assessment = latest?.riskAssessment ?? null

  return (
    <Panel
      title="Unified Risk Assessment"
      subtitle="Combined explainable risk scoring from all security findings"
      action={assessment ? (
        <Badge variant={assessment.level === 'none' ? 'none' : assessment.level === 'low' ? 'low' : assessment.level === 'medium' ? 'medium' : assessment.level === 'high' ? 'high' : 'critical'}>
          {assessment.level.toUpperCase()} ({assessment.score}/100)
        </Badge>
      ) : undefined}
    >

      {!assessment ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Run a scan from Browser Capture to see the unified risk assessment.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Score bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Risk Score</span>
              <span style={{ fontWeight: 700, color: RISK_LEVEL_COLOR[assessment.level] }}>{assessment.score}/100</span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-input)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${assessment.score}%`,
                height: '100%',
                background: RISK_LEVEL_COLOR[assessment.level],
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Confidence: {(assessment.confidence * 100).toFixed(0)}%
            </div>
          </div>

          {/* Category breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {(['privacy', 'injection', 'deception'] as RiskCategory[]).map(cat => {
              const catData = assessment.categories[cat]
              return (
                <div key={cat} style={{
                  padding: '10px 12px',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    {CATEGORY_LABELS[cat]}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: RISK_LEVEL_COLOR[catData.level] }}>
                    {catData.score}
                  </div>
                  <div style={{ fontSize: 11, color: RISK_LEVEL_COLOR[catData.level], marginTop: 2 }}>
                    {catData.level.toUpperCase()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Explanation */}
          <div style={{
            padding: '10px 12px',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Analysis
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              {assessment.explanation}
            </p>
          </div>

          {/* Recommendation */}
          <div style={{
            padding: '10px 12px',
            background: assessment.level === 'critical' ? 'rgba(239,68,68,0.08)' : assessment.level === 'high' ? 'rgba(249,115,22,0.08)' : 'var(--bg-card)',
            borderRadius: 'var(--radius)',
            border: `1px solid ${assessment.level === 'critical' ? 'var(--red)' : assessment.level === 'high' ? 'var(--orange)' : 'var(--border)'}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Recommendation
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0, fontWeight: assessment.level === 'critical' ? 600 : 400 }}>
              {assessment.recommendation}
            </p>
          </div>

          {/* Contributing findings */}
          {assessment.contributions.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Contributing Findings ({assessment.contributions.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {assessment.contributions.map((c, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px',
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    fontSize: 12,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: RISK_LEVEL_COLOR[c.severity],
                      flexShrink: 0,
                    }} />
                    <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', minWidth: 60 }}>
                      {c.category}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', flex: 1 }}>
                      {c.detail}
                    </span>
                    <span style={{ color: RISK_LEVEL_COLOR[c.severity], fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>
                      {c.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

const SEVERITY_FILTER_ORDER: RiskLevel[] = ['critical', 'high', 'medium', 'low']
const CATEGORY_FILTER_OPTIONS: RiskCategory[] = ['privacy', 'injection', 'deception']

const EVIDENCE_STRENGTH_LABEL: Record<string, { label: string; color: string }> = {
  SINGLE_SOURCE: { label: 'Single Source', color: 'var(--text-muted)' },
  MULTI_SOURCE: { label: 'Multi-Source', color: 'var(--cyan)' },
  CROSS_MODAL: { label: 'Cross-Modal', color: 'var(--accent)' },
}

const EVIDENCE_SOURCE_ICON: Record<string, string> = {
  DOM: 'DOM',
  OCR: 'OCR',
  CORRELATION: 'CORR',
  CROSS_VALIDATION: 'CV',
}

function SecurityFindingsPanel({ scanResults }: { scanResults: ScanResult[] }) {
  const latest = scanResults[scanResults.length - 1] ?? null
  const findings = useMemo(() => {
    if (!latest) return []
    return latest.findings.length > 0 ? latest.findings : aggregateFindings(latest)
  }, [latest])

  const [severityFilter, setSeverityFilter] = useState<RiskLevel | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<RiskCategory | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [exported, setExported] = useState(false)

  const filtered = useMemo(() => {
    let result = findings
    if (severityFilter !== 'all') result = result.filter(f => f.severity === severityFilter)
    if (categoryFilter !== 'all') result = result.filter(f => f.category === categoryFilter)
    return result
  }, [findings, severityFilter, categoryFilter])

  const counts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const f of findings) {
      if (f.severity in c) c[f.severity]++
    }
    return c
  }, [findings])

  const handleExport = () => {
    if (!latest) return
    const report = generateReport(latest, findings)
    downloadReport(report)
    setExported(true)
    setTimeout(() => setExported(false), 2000)
  }

  return (
    <Panel
      title="Security Findings"
      subtitle={`${findings.length} finding${findings.length !== 1 ? 's' : ''} detected`}
      action={
        latest && (
          <Button variant="ghost" size="sm" onClick={handleExport}>
            {exported ? 'Exported!' : 'Export Report'}
          </Button>
        )
      }
    >
      {findings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
          <CheckCircleIcon size={32} />
          <p style={{ fontSize: 14, marginTop: 8 }}>No significant security findings detected.</p>
          <p style={{ fontSize: 12 }}>Run a scan from Browser Capture to analyze a page.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Summary counters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SEVERITY_FILTER_ORDER.map(sev => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(severityFilter === sev ? 'all' : sev)}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 12,
                  border: severityFilter === sev ? `1px solid ${RISK_LEVEL_COLOR[sev]}` : '1px solid var(--border)',
                  background: severityFilter === sev ? `color-mix(in srgb, ${RISK_LEVEL_COLOR[sev]} 12%, var(--bg-card))` : 'var(--bg-card)',
                  color: counts[sev] > 0 ? RISK_LEVEL_COLOR[sev] : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {sev.charAt(0).toUpperCase() + sev.slice(1)}: {counts[sev]}
              </button>
            ))}
          </div>

          {/* Category filters */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setCategoryFilter('all')}
              style={{
                padding: '3px 8px', fontSize: 11, borderRadius: 8,
                border: categoryFilter === 'all' ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: categoryFilter === 'all' ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))' : 'var(--bg-card)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >All</button>
            {CATEGORY_FILTER_OPTIONS.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
                style={{
                  padding: '3px 8px', fontSize: 11, borderRadius: 8,
                  border: categoryFilter === cat ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: categoryFilter === cat ? 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))' : 'var(--bg-card)',
                  color: 'var(--text-secondary)', cursor: 'pointer', textTransform: 'capitalize',
                }}
              >{cat}</button>
            ))}
          </div>

          {/* Finding cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(finding => (
              <FindingCard
                key={finding.id}
                finding={finding}
                expanded={expandedId === finding.id}
                onToggle={() => setExpandedId(expandedId === finding.id ? null : finding.id)}
              />
            ))}
            {filtered.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 12 }}>
                No findings match the selected filters.
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}

function FindingCard({ finding, expanded, onToggle }: { finding: SecurityFinding; expanded: boolean; onToggle: () => void }) {
  const strengthInfo = EVIDENCE_STRENGTH_LABEL[finding.evidenceStrength]
  const sources = new Set(finding.evidence.map(e => e.source))

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: 'var(--radius)',
      border: `1px solid ${finding.severity === 'critical' ? 'var(--red)' : 'var(--border)'}`,
      overflow: 'hidden',
    }}>
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '10px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: RISK_LEVEL_COLOR[finding.severity], flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {finding.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Confidence: {(finding.confidence * 100).toFixed(0)}% · {finding.evidence.length} evidence source{finding.evidence.length !== 1 ? 's' : ''}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
          background: `color-mix(in srgb, ${RISK_LEVEL_COLOR[finding.severity]} 12%, transparent)`,
          color: RISK_LEVEL_COLOR[finding.severity], textTransform: 'uppercase',
        }}>
          {finding.severity}
        </span>
        {/* Evidence strength badge */}
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 4,
          border: `1px solid ${strengthInfo.color}`,
          color: strengthInfo.color, textTransform: 'uppercase', letterSpacing: '0.03em',
        }}>
          {strengthInfo.label}
        </span>
        {/* Source badges */}
        <div style={{ display: 'flex', gap: 3 }}>
          {Array.from(sources).map(s => (
            <span key={s} style={{
              fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3,
              background: 'var(--bg-input)', color: 'var(--text-muted)',
            }}>
              {EVIDENCE_SOURCE_ICON[s]}
            </span>
          ))}
        </div>
        <span style={{ fontSize: 14, color: 'var(--text-muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          ▾
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
            {finding.description}
          </p>

          {/* Evidence items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {finding.evidence.map((ev, i) => (
              <EvidenceItemView key={i} item={ev} />
            ))}
          </div>

          {/* Recommendation */}
          <div style={{
            padding: '8px 10px', fontSize: 12,
            background: 'color-mix(in srgb, var(--accent) 6%, var(--bg-input))',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Recommendation:
            </span>{' '}
            {finding.recommendation}
          </div>
        </div>
      )}
    </div>
  )
}

function EvidenceItemView({ item }: { item: EvidenceItem }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: 'var(--bg-input)',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
          background: item.source === 'OCR' ? 'var(--cyan)' : item.source === 'CORRELATION' ? 'var(--accent)' : item.source === 'CROSS_VALIDATION' ? 'var(--yellow)' : 'var(--orange)',
          color: 'var(--bg-card)', textTransform: 'uppercase',
        }}>
          {item.source}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
          {item.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        {item.detail}
      </div>
      {item.selector && (
        <code style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-muted)', display: 'block', marginTop: 3 }}>
          {item.selector}
        </code>
      )}
      {item.element && (
        <code style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--orange)', display: 'block', marginTop: 2 }}>
          &lt;{item.element}&gt;
        </code>
      )}
      {item.attributes && Object.keys(item.attributes).length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          {Object.entries(item.attributes).map(([k, v]) => (
            <code key={k} style={{ fontSize: 9, fontFamily: 'var(--mono)', padding: '1px 4px', background: 'var(--bg-card)', borderRadius: 3, color: 'var(--text-muted)' }}>
              {k}="{v}"
            </code>
          ))}
        </div>
      )}
      {item.ocrText && (
        <div style={{ marginTop: 4 }}>
          <code style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>
            "{item.ocrText}"
          </code>
          {item.ocrConfidence != null && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
              OCR confidence: {(item.ocrConfidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}
      {item.boundingBox && (
        <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-muted)', marginTop: 3 }}>
          bbox: {item.boundingBox.x},{item.boundingBox.y} {item.boundingBox.width}x{item.boundingBox.height}
        </div>
      )}
      {item.visibility && (
        <span style={{ fontSize: 10, color: 'var(--red)', display: 'block', marginTop: 3 }}>
          visibility: {item.visibility}
        </span>
      )}
    </div>
  )
}
