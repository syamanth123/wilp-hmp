/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: { bodySizeLimit: '5mb' },
  },
  transpilePackages: ['@hmp/db', '@hmp/auth', '@hmp/ui', '@hmp/workflow'],
};

export default nextConfig;
