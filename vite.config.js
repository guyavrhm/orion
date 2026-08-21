import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.', // root is the project root where index.html is
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/stream': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/subtitles': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,woff,woff2}']
      },
      manifest: {
        name: 'Orion',
        short_name: 'Orion',
        description: 'Orion Media Streamer',
        theme_color: '#141414',
        background_color: '#141414',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'assets/images/orion.jpg',
            sizes: '192x192',
            type: 'image/jpeg'
          },
          {
            src: 'assets/images/orion.jpg',
            sizes: '512x512',
            type: 'image/jpeg'
          }
        ]
      }
    })
  ]
});
