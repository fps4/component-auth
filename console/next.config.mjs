/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → a self-contained server bundle for the Docker image.
  output: 'standalone',
  reactStrictMode: true,
  webpack(config) {
    // vega-canvas optionally requires the native `canvas` module for Node-side raster rendering.
    // The chart wrapper renders SVG in the browser, so `canvas` is never used — mark it external.
    config.externals = [...(config.externals ?? []), { canvas: 'canvas' }];
    return config;
  },
};

export default nextConfig;
