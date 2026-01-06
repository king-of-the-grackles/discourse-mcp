export default {
  esbuild: {
    // Mark SDK packages as external - Smithery's runtime provides them
    external: [
      "@modelcontextprotocol/sdk",
      "@smithery/sdk",
      "zod",
    ],
    // Set Node.js target version
    target: "node22",
  },
};
