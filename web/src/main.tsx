import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { startNativeBridge } from './lib/android';
import { isElectron } from './lib/api';
import { isWidgetMode } from './lib/notify';

if (isWidgetMode()) document.documentElement.classList.add('widget-mode');
if (isElectron()) document.documentElement.classList.add('electron');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startNativeBridge();

if ('serviceWorker' in navigator && window.isSecureContext && !isElectron()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // 局域网 HTTP 环境下无法注册，不影响 App 内提醒
    });
  });
}
