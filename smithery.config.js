export default {
  esbuild: {
    // Mark problematic packages as external to avoid bundling issues
    external: [],
    // Enable minification for smaller output
    minify: false,
    // Set Node.js target version
    target: "node22",
    // Log level for debugging
    logLevel: "info",
  },
};
