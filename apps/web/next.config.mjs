// The browser always calls the API on the same address as the website (/api/...),
// and Next.js passes those calls on to the API server. This works on a laptop,
// in GitHub Codespaces and behind any proxy, with no cross-origin setup.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }];
  },
};
export default nextConfig;
