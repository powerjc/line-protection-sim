import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow the dev server to be reached through Tailscale Serve (*.ts.net)
    allowedHosts: ['.ts.net'],
  },
})
