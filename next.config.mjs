/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Emits .next/standalone — a self-contained server with only the modules it
  // actually imports. The container copies that instead of node_modules, which
  // is what keeps the image small enough to rebuild comfortably on the box.
  output: "standalone",

  // Never advertise the framework version to anything on the tailnet.
  poweredByHeader: false,
};

export default nextConfig;
