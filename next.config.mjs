/** @type {import('next').NextConfig} */
const nextConfig = {
  // The research pipeline pulls in server-only SDKs; keep them external to the bundle.
  serverExternalPackages: ['pg', '@ai-sdk/anthropic', '@ai-sdk/google', 'ai'],
  webpack: (config) => {
    // src/ uses ESM ".js" import specifiers that resolve to ".ts" files.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
