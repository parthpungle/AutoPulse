import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initTheme } from './theme.js';
import './styles.css';

initTheme();                                           // before the first paint: no flash of the other theme
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
