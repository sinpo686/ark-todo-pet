import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function TodoWindow(): React.JSX.Element {
  return <div id="todo-window-root">Todo Window Placeholder</div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TodoWindow />
  </StrictMode>
)
