import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function devBridgePlugin(): Plugin {
    return {
        name: 'dev-ipc-bridge',
        configureServer(server) {
            try {
                const { createDevBridgeHandler } = require('./electron/devBridge.cjs');
                server.middlewares.use('/api/ipc', createDevBridgeHandler());
            } catch (err) {
                console.warn('[devBridgePlugin] Could not initialize dev IPC bridge:', err);
            }
        }
    };
}

export default defineConfig({
    base: './',
    plugins: [
        devBridgePlugin(),
        react(),
        electron([
            {
                entry: 'electron/main.ts',
                onstart(options) {
                    options.startup();
                },
                vite: {
                    build: {
                        outDir: 'dist-electron',
                        minify: false,
                        rollupOptions: {
                            external: ['electron', 'prisma', '@prisma/client', 'xlsx', 'usb-detection', '../prisma/generated/client']
                        }
                    }
                }
            },
            {
                entry: 'electron/preload.ts',
                onstart(options) {
                    options.reload();
                },
                vite: {
                    build: {
                        outDir: 'dist-electron'
                    }
                }
            }
        ]),
        renderer()
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src')
        }
    },
    server: {
        port: 5173,
        host: true
    },
    build: {
        outDir: 'dist'
    }
});
