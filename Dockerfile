# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Build Smithery bundle
RUN npx @smithery/cli build -o .smithery/index.cjs

# Production stage
FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/.smithery ./.smithery
COPY --from=builder /app/dist ./dist

# Expose port for HTTP transport
EXPOSE 8080

# Start the server
CMD ["node", ".smithery/index.cjs"]
