import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import '@atlaskit/css-reset';
import './styles/app.css';
import { App } from './App';
import { bridgeCall } from './lib/preview';

// Pull Jira's light/dark design tokens into the iframe. Outside Jira this
// rejects and the token fallbacks apply.
bridgeCall(() => view.theme.enable()).catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
