import { Panel } from '../components/ui/Panel'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

export function Settings() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Panel title="General">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SettingRow
            label="Local Processing Only"
            description="All analysis runs in-browser. No data sent to external servers."
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Auto-scan on Capture"
            description="Automatically run all detectors when content is captured."
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Store Scan History"
            description="Save scan results in local storage for later review."
            control={<ToggleSwitch checked />}
          />
        </div>
      </Panel>

      <Panel title="Privacy Detection">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SettingRow
            label="Email Detection"
            description="Detect and redact email addresses."
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Phone Number Detection"
            description="Detect US and international phone formats."
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="SSN Detection"
            description="Detect Social Security Number patterns."
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Credit Card Detection"
            description="Detect credit card number patterns."
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Address Detection"
            description="Detect physical addresses via heuristics."
            control={<Badge variant="default">Planned</Badge>}
          />
        </div>
      </Panel>

      <Panel title="Injection Detection">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SettingRow
            label="Direct Injection Patterns"
            description='Detect "ignore instructions", "you are now" style attacks.'
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Indirect Manipulation"
            description='Detect "pretend to be", "act as if" social engineering.'
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Hidden Element Scanning"
            description="Detect display:none, visibility:hidden, zero-size, offscreen elements."
            control={<ToggleSwitch checked />}
          />
          <SettingRow
            label="Encoded Payload Detection"
            description="Detect Base64 and Unicode obfuscated injections."
            control={<Badge variant="default">Planned</Badge>}
          />
        </div>
      </Panel>

      <Panel title="Data Management">
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm">Export Settings</Button>
          <Button variant="secondary" size="sm">Import Settings</Button>
          <Button variant="danger" size="sm">Clear All Data</Button>
        </div>
      </Panel>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Badge variant="info" dot>Privacy Agent v0.1</Badge>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            All processing is performed locally. No telemetry or external data transmission.
          </p>
        </div>
      </Card>
    </div>
  )
}

function SettingRow({ label, description, control }: { label: string; description: string; control: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '4px 0',
    }}>
      <div>
        <p style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{label}</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{description}</p>
      </div>
      {control}
    </div>
  )
}

function ToggleSwitch({ checked = false }: { checked?: boolean }) {
  return (
    <div style={{
      width: 40,
      height: 22,
      borderRadius: 11,
      background: checked ? 'var(--accent)' : 'var(--border)',
      position: 'relative',
      cursor: 'pointer',
      flexShrink: 0,
      transition: 'background 0.15s',
    }}>
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: '#fff',
        position: 'absolute',
        top: 3,
        left: checked ? 21 : 3,
        transition: 'left 0.15s',
      }} />
    </div>
  )
}
