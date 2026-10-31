import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentChatProvider } from './AgentChat';
import { App } from './App';
import { ColorModeProvider } from './theme/ColorModeProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorModeProvider>
      {/* O chat com os agentes abre em qualquer página do site. */}
      <AgentChatProvider>
        <App />
      </AgentChatProvider>
    </ColorModeProvider>
  </StrictMode>,
);
