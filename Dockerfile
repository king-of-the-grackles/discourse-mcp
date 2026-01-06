# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Install system dependencies for native modules (keytar needs libsecret)
RUN apt-get update && apt-get install -y \
    libsecret-1-dev \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-slim

WORKDIR /app

# Install runtime library for keytar (if needed by Smithery SDK)
RUN apt-get update && apt-get install -y \
    libsecret-1-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port for HTTP transport
EXPOSE 8080

# Start the HTTP server
CMD ["node", "dist/smithery-entry.js"]
