import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createApiClient } from './api/client';
import { config } from './config';
import './styles.css';

const api = createApiClient({ baseUrl: config.apiBaseUrl });

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
