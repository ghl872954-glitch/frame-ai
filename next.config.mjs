/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 开发时左下角那个悬浮球会挡住界面，关掉
  devIndicators: false,
  // 本地运行时允许长连接的流式响应
  experimental: {
    proxyTimeout: 300_000,
  },
};

export default nextConfig;
