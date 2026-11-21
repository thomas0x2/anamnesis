import 'katex/dist/katex.min.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { pickBackend } from './backend'
import { setLinkHandler } from './components/Markdown'
import { createApp } from './engine/app'

async function boot(): Promise<void> {
  const backend = await pickBackend()
  const app = createApp(backend)
  setLinkHandler((href) => {
    if (/^https?:\/\//i.test(href)) void backend.openExternal(href)
  })
  const saveAll = async (): Promise<void> => {
    await app.session.get()?.save()
    await app.flush()
  }
  backend.onBeforeQuit?.(saveAll)
  window.addEventListener('pagehide', () => void saveAll())
  try {
    await app.init()
  } catch (e) {
    console.error('init failed', e)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void boot()
