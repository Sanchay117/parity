import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on GitHub Pages under /<repo>/ as well as at a root domain.
export default defineConfig({
  base: './',
  plugins: [react()],
});
