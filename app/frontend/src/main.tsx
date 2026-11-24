import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { createMockApi } from './api/mock';
import './index.css';

// Mock backend until Felix's API is live (team plan: integrate Nov 22). The latency makes
// pending states (disabled buttons) visible while developing.
const api = createMockApi({ latencyMs: 300 });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App api={api} />
    </BrowserRouter>
  </StrictMode>,
);
