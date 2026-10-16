import { createRoot } from 'react-dom/client';
import { applyThemeCSS } from '../experience/theme';
import { Landing } from './Landing';
import './landing.css';

// No StrictMode here: its double mount would build the GPU pipeline twice in development.
// The engine is remount-safe anyway (it owns its canvas and disposes everything).
applyThemeCSS();
createRoot(document.getElementById('root')!).render(<Landing />);
