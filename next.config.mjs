/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * The Design team has left and /design no longer exists. Anyone with the
   * old URL bookmarked — or an old notification link — is sent to the
   * dashboard instead of hitting a 404. Permanent, because the route is
   * never coming back.
   */
  async redirects() {
    return [
      { source: "/design", destination: "/overview", permanent: true },
      { source: "/design/:path*", destination: "/overview", permanent: true },
    ];
  },
};
export default nextConfig;
