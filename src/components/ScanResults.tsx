import type { ScanResult } from '../types/scan'
import { RiskBadge } from './RiskBadge'

export function ScanResults({ result }: { result: ScanResult }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Scan Results</h3>
        <RiskBadge level={result.risk.overall} />
        {result.url && (
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{result.url}</span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <ScoreCard label="Privacy Risk" score={result.risk.privacy} count={result.piiMatches.length} unit="PII matches" />
        <ScoreCard label="Injection Risk" score={result.risk.injection} count={result.promptInjections.length} unit="injections" />
        <ScoreCard label="Hidden Content" score={result.risk.hidden} count={result.hiddenContent.length} unit="elements" />
      </div>

      {result.piiMatches.length > 0 && (
        <Section title="PII Detected">
          {result.piiMatches.map((m, i) => (
            <FindingRow key={i} type={m.type} detail={`"${m.value}" -> ${m.redacted}`} meta={`confidence: ${(m.confidence * 100).toFixed(0)}%`} />
          ))}
        </Section>
      )}

      {result.promptInjections.length > 0 && (
        <Section title="Prompt Injections">
          {result.promptInjections.map((inj, i) => (
            <FindingRow key={i} type={`${inj.severity} ${inj.type}`} detail={inj.content} />
          ))}
        </Section>
      )}

      {result.hiddenContent.length > 0 && (
        <Section title="Hidden Content">
          {result.hiddenContent.map((h, i) => (
            <FindingRow key={i} type={h.technique} detail={`<${h.element}> ${h.content.slice(0, 120)}`} meta={h.selector} />
          ))}
        </Section>
      )}
    </div>
  )
}

function ScoreCard({ label, score, count, unit }: { label: string; score: number; count: number; unit: string }) {
  const color = score >= 80 ? '#ef4444' : score >= 60 ? '#f97316' : score >= 30 ? '#eab308' : '#22c55e'
  return (
    <div style={{ padding: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--code-bg)' }}>
      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{score}</div>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>{count} {unit}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: 15 }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  )
}

function FindingRow({ type, detail, meta }: { type: string; detail: string; meta?: string }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'var(--mono)' }}>
      <span style={{ fontWeight: 600, textTransform: 'uppercase', marginRight: 8, color: 'var(--accent)' }}>{type}</span>
      <span style={{ color: 'var(--text-h)' }}>{detail}</span>
      {meta && <span style={{ marginLeft: 8, color: 'var(--text)', fontSize: 12 }}>{meta}</span>}
    </div>
  )
}
