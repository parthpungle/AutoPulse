import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import VehicleApp from './VehicleApp.jsx';
import '../styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VehicleApp />
  </StrictMode>,
);
