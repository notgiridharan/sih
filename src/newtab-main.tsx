import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SentinelWidget } from './components/SentinelWidget'
import { NewTabPageSource } from './services/prompt-processor'
import './widget.css'

createRoot(document.getElementById('sentinel-widget-root')!).render(
  <StrictMode>
    <SentinelWidget pageSource={new NewTabPageSource()} />
  </StrictMode>,
)
