/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    esmExternals: true,
    typedRoutes: true,
    serverActions: {
      bodySizeLimit: '1mb'
    }
  }
};

export default nextConfig;

