import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; Next transpiles them in-place.
  transpilePackages: ['@claimwatch/core', '@claimwatch/pipeline'],
  // Linting runs once at the repo root (`just lint`) with the shared flat config.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
