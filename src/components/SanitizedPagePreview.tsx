import React, { useMemo } from 'react'
import { Card } from './ui/Card'
import { Panel } from './ui/Panel'
import { Badge } from './ui/Badge'
import { ShieldIcon, EyeIcon, AlertIcon } from './ui/Icons'
import { sanitize } from '../services/sanitization'
import type { SanitizationOutput, SanitizationStatistics } from '../services/sanitization'
import type { Redaction } from '../types/agent'
import type { PIICategory } from '../types/scan'

// --- Props ---

interface SanitizedPagePreviewProps {
  domContent: string | null
  loading?: boolean
  error?: string | null
}

// --- Placeholder highlighting ---

const PLACEHOLDER_RE = /\[(EMAIL|PHONE|PASSWORD|NAME|ADDRESS|SSN|GOVID|CARD|BANKACCT|UPI|APIKEY|SESSION|DOB|SENSITIVE)_\d{3}\]/g

function highlightPlaceholders(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  const re = new RegExp(PLACEHOLDER_RE.source, 'g')
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      <span
        key={match.index}
        style={{
          background: 'var(--accent-muted)',
          color: 'var(--accent-hover)',
          padding: '1px 4px',
          borderRadius: 'var(--radius-sm)',
          fontWeight: 600,
        }}
      >
        {match[0]}
      </span>,
    )
    lastIndex = re.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

// --- Category display ---

const CATEGORY_LABEL: Partial<Record<PIICategory, string>> = {
  email: 'Email',
  phone: 'Phone',
  password_field: 'Password',
  name: 'Name',
  address: 'Address',
  ssn: 'SSN',
  pan: 'PAN',
  aadhaar: 'Aadhaar',
  credit_card: 'Card',
  bank_account: 'Bank Acct',
  upi_id: 'UPI',
  api_key: 'API Key',
  session_id: 'Session',
  date_of_birth: 'DOB',
  custom: 'Form Value',
}

function categoryColor(cat: PIICategory): string {
  switch (cat) {
    case 'email': return 'var(--cyan)'
    case 'phone': return 'var(--yellow)'
    case 'password_field':
    case 'api_key':
    case 'session_id': return 'var(--red)'
    case 'credit_card':
    case 'bank_account':
    case 'upi_id': return 'var(--orange)'
    case 'ssn':
    case 'pan':
    case 'aadhaar': return 'var(--red)'
    default: return 'var(--text-secondary)'
  }
}

// --- Sub-components ---

function LoadingState() {
  return (
    <Card>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '40px 20px',
      }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: '3px solid var(--border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Sanitizing page content...
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Detecting and redacting sensitive information locally
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </Card>
  )
}

function EmptyState() {
  return (
    <Card>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '40px 20px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--accent-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-hover)',
        }}>
          <EyeIcon size={24} />
        </div>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>
          No page content to preview
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 300 }}>
          Capture a page or provide DOM content to see what will be exposed to the agent.
        </p>
      </div>
    </Card>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: 4,
      }} role="alert">
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--radius)',
          background: 'var(--red-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--red)',
          flexShrink: 0,
        }}>
          <AlertIcon size={18} />
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
            Sanitization failed
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {message}
          </p>
        </div>
      </div>
    </Card>
  )
}

function PrivacySummary({ statistics }: { statistics: SanitizationStatistics }) {
  const items = [
    { label: 'Sensitive elements', value: statistics.totalSensitiveElements, color: 'var(--orange)' },
    { label: 'Values redacted', value: statistics.totalRedactions, color: 'var(--red)' },
    { label: 'Emails', value: statistics.emails, color: 'var(--cyan)' },
    { label: 'Phones', value: statistics.phones, color: 'var(--yellow)' },
    { label: 'Credentials', value: statistics.credentials, color: 'var(--red)' },
    { label: 'Form values', value: statistics.formValues, color: 'var(--accent)' },
    { label: 'Other sensitive', value: statistics.otherSensitive, color: 'var(--text-secondary)' },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
      gap: 8,
    }}>
      {items.map(item => (
        <div key={item.label} style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '10px 12px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: 20,
            fontWeight: 700,
            color: item.value > 0 ? item.color : 'var(--text-muted)',
            fontFamily: 'var(--mono)',
            lineHeight: 1,
          }}>
            {item.value}
          </div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            marginTop: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontWeight: 500,
          }}>
            {item.label}
          </div>
        </div>
      ))}
    </div>
  )
}

function RedactionList({ redactions }: { redactions: Redaction[] }) {
  if (redactions.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
        No redactions applied — content appears clean.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {redactions.map((r, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 0',
          borderBottom: i < redactions.length - 1 ? '1px solid var(--border)' : 'none',
          fontSize: 12,
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: categoryColor(r.category),
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: categoryColor(r.category),
            minWidth: 64,
          }}>
            {CATEGORY_LABEL[r.category] ?? r.category}
          </span>
          <code style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--accent-hover)',
            background: 'var(--accent-muted)',
            padding: '1px 6px',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
          }}>
            {r.placeholder}
          </code>
          {r.location.selector && (
            <code style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              color: 'var(--text-muted)',
              marginLeft: 'auto',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 180,
            }}>
              {r.location.selector}
            </code>
          )}
        </div>
      ))}
    </div>
  )
}

function SanitizedContentView({ content }: { content: string }) {
  const lines = content.split('\n')

  return (
    <pre style={{
      fontFamily: 'var(--mono)',
      fontSize: 12,
      color: 'var(--text-secondary)',
      background: 'var(--bg-input)',
      padding: 14,
      borderRadius: 'var(--radius)',
      overflow: 'auto',
      margin: 0,
      lineHeight: 1.7,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: 400,
    }}>
      {lines.map((line, i) => (
        <div key={i}>{highlightPlaceholders(line)}{'\n'}</div>
      ))}
    </pre>
  )
}

function PrivacyShieldBanner() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 14px',
      background: 'var(--green-muted)',
      border: '1px solid rgba(34, 197, 94, 0.25)',
      borderRadius: 'var(--radius)',
      fontSize: 12,
      color: 'var(--green)',
      fontWeight: 500,
    }}>
      <ShieldIcon size={16} />
      Only sanitized data will be provided to the agent.
    </div>
  )
}

// --- Main component ---

export function SanitizedPagePreview({ domContent, loading, error }: SanitizedPagePreviewProps) {
  const result: SanitizationOutput | null = useMemo(() => {
    if (!domContent) return null
    try {
      return sanitize(domContent)
    } catch {
      return null
    }
  }, [domContent])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!domContent) return <EmptyState />

  if (!result) {
    return <ErrorState message="Failed to sanitize page content. The DOM may be malformed." />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fade-in 0.3s ease' }}>
      <PrivacyShieldBanner />

      <Panel title="Privacy Summary" subtitle={`${result.statistics.totalRedactions} redaction${result.statistics.totalRedactions !== 1 ? 's' : ''} applied`}>
        <PrivacySummary statistics={result.statistics} />
      </Panel>

      <Panel
        title="Redaction Map"
        subtitle="Placeholders replacing sensitive values"
        action={
          <Badge variant="info">{result.redactions.length} items</Badge>
        }
      >
        <RedactionList redactions={result.redactions} />
      </Panel>

      <Panel title="Sanitized Content" subtitle="What the agent will see">
        <SanitizedContentView content={result.sanitizedContent} />
      </Panel>
    </div>
  )
}
