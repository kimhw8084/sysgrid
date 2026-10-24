import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

function sourceFingerprint(root: string): string {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && !entry.name.includes('.test.')) files.push(path)
    }
  }
  visit(root)
  const digest = createHash('sha256')
  for (const path of files.sort()) digest.update(relative(root, path).split(sep).join('/') + '\0').update(readFileSync(path)).update('\0')
  return digest.digest('hex')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const frontendPort = parseInt(env.VITE_PORT || '5173', 10);
  const backendPort = parseInt(env.VITE_BACKEND_PORT || '8000', 10);
  const backendHost = env.VITE_BACKEND_HOST || '127.0.0.1';
  const apiTarget = env.VITE_API_BASE_URL || `http://${backendHost}:${backendPort}`;

  return {
    plugins: [react(), {
      name: 'sysgrid-release-identity',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'sysgrid-build.json', source: JSON.stringify({
          schema_version: 1, source_sha256: sourceFingerprint(resolve(process.cwd(), 'src')),
          identity_mode: env.VITE_IDENTITY_MODE || null, api_base_url: env.VITE_API_BASE_URL || '',
        }) })
      },
    }],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      exclude: ['tests/**', 'node_modules/**', 'dist/**'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: ['src/**/*.d.ts'],
      },
    },
    server: {
      port: frontendPort,
      host: '127.0.0.1',
      strictPort: true,
      allowedHosts: [],
      fs: {
        allow: ['..'],
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        }
      }
    }
  }
})
