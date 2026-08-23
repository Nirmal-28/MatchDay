import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installErrorHandlers } from './lib/monitoring'

// Catch what React cannot: errors thrown outside the render tree (event
// handlers, timers) and promise rejections nobody awaited. Installed before
// the first render so a failure during mount is still recorded.
installErrorHandlers()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
