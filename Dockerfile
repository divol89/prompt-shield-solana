# Dockerfile for Prompt Shield API & Playground

FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code and public assets
COPY . .

# Build TypeScript code
RUN npm run build

# Set environment to production
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# Start the server
CMD ["node", "dist/index.js"]
