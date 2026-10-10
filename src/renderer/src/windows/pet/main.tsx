import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function PetWindow(): React.JSX.Element {
  return <div id="pet-window-root">Pet Window Placeholder</div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetWindow />
  </StrictMode>
)
