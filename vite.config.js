import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // When deploying to GitHub Pages, set base to your repo name:
  // base: '/your-repo-name/'
  base: '/',
});
