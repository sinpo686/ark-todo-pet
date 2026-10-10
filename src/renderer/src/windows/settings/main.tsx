import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function SettingsWindow(): React.JSX.Element {
  return <div id="settings-window-root">Settings Window Placeholder</div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsWindow />
  </StrictMode>
)
