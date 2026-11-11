import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served from the site root by default (dev, Docker). GitHub Pages serves the
  // project under /line-protection-sim/, so its workflow sets VITE_BASE.
  base: process.env.VITE_BASE || '/',
  server: {
    // Allow the dev server to be reached through Tailscale Serve (*.ts.net)
    allowedHosts: ['.ts.net'],
  },
})
