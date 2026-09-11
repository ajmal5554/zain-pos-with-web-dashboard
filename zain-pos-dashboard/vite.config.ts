import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'masked-icon.svg',
        'icons/badge.png',
        'icons/icon-512x512.png',
        'icons/icon-maskable-512x512.png',
        'icons/icon-monochrome-512x512.png',
        'icons/icon-192x192.png',
        'icons/icon-maskable-192x192.png',
        'icons/icon-monochrome-192x192.png',
        'sounds/cash-register.wav',
        'sounds/notification.mp3'
      ],
      manifest: {
        id: '/',
        name: 'Zain POS',
        short_name: 'Zain POS',
        description: 'Real-time Sales Dashboard for Zain POS',
        start_url: '/',
        scope: '/',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icons/icon-monochrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome'
          },
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icons/icon-monochrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'monochrome'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom')
    }
  },
  server: {
    port: 5173,
    host: true
  }
})
