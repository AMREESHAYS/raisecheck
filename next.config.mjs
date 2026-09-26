/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite ships WASM and must not be bundled into the server build.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
