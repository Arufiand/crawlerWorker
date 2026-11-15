FROM node:26.12.1-slim AS node_base

# --- Builder Stage ---
FROM mcr.microsoft.com/playwright:v1.65.1-noble AS builder

COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app

# Install all dependencies (including TypeScript) to compile the project
COPY package*.json ./
RUN HUSKY=0 npm ci

# Copy TypeScript config, Prisma config, and source code
COPY tsconfig.json prisma.config.ts ./
COPY src ./src

# Compile TypeScript -> dist/ (also copies contract.json via resolveJsonModule)
RUN npm run build

# --- Production Runtime Stage ---
FROM mcr.microsoft.com/playwright:v1.65.1-noble

COPY --from=node_base /usr/local/bin/node /usr/local/bin/node
COPY --from=node_base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies and skip dev lifecycle hooks like husky
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output and Prisma contract files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/prisma ./src/prisma

# Run as the non-root user built into the Playwright image
USER pwuser

CMD ["node", "dist/index.js"]
