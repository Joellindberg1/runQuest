import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installStaleChunkReload } from '@/shared/utils/staleChunkReload'

installStaleChunkReload(window, () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
});

createRoot(document.getElementById("root")!).render(<App />);
