import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source; Next transpiles them in-place.
  transpilePackages: ['@claimwatch/core', '@claimwatch/pipeline'],
};

export default nextConfig;
