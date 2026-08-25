import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16.3 writes AGENTS.md and CLAUDE.md into this package on every dev
  // run and build. This repository keeps its own CLAUDE.md at the root, and
  // generated copies here only add noise to the working tree.
  agentRules: false,

  // Emits .next/standalone with a server and only the modules it actually
  // traced, which is what the Docker image copies. Additive: `next start`
  // and `next dev` are unaffected, so nothing outside Docker changes.
  output: "standalone",

  // Bundle optimization — tree-shake these large package re-exports
  experimental: {
    optimizePackageImports: [
      "@hugeicons/react",
      "@hugeicons/core-free-icons",
      "lucide-react",
      "recharts",
      "date-fns",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "react-pdf",
      "react-dnd",
      "react-dnd-html5-backend",
      "socket.io-client",
    ],
  },
  // Strip console.* in production (keep error/warn)
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
