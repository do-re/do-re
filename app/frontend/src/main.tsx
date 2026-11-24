import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { selectBackend } from './backend';
import './index.css';

// Runs on the demo until VITE_API_BASE_URL is set (see .env.example).
void selectBackend(import.meta.env.VITE_API_BASE_URL as string | undefined).then(({ api, createPlayer }) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App api={api} createPlayer={createPlayer} />
      </BrowserRouter>
    </StrictMode>,
  );
});
