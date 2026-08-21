# Stage 1: Build the Vite frontend and backend
FROM node:22-slim AS builder

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build both frontend assets and backend into dist/
RUN npm run build:all

FROM node:22-slim

# Install Python and virtual environment packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment and install ffsubsync
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir ffsubsync

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled frontend and backend assets from builder stage with correct permissions
COPY --chown=node:node --from=builder /app/dist ./dist

# Copy static public assets with correct permissions
COPY --chown=node:node public ./public

# Expose port 3000 (default port for Orion backend)
EXPOSE 3000

# Set production environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Start the all-in-one server and background workers
CMD ["npm", "run", "start:all"]
