import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The browser always calls the API on the same address as the website (/api/...),
// and Next.js passes those calls on to the API server. This works on a laptop,
// in GitHub Codespaces and behind any proxy, with no cross-origin setup.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

/** Security headers for every page. Turnstile (the sign-in CAPTCHA) needs challenges.cloudflare.com. */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Docker image sets NEXT_OUTPUT=standalone for a small self-contained server
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // npm workspaces: trace files from the repository root so the standalone server finds shared node_modules
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
