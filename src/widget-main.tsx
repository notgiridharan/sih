import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SentinelWidget } from './components/SentinelWidget'
import './widget.css'

createRoot(document.getElementById('sentinel-widget-root')!).render(
  <StrictMode>
    <SentinelWidget />
  </StrictMode>,
)
