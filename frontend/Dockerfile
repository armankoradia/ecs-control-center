# Use multi-platform base image
FROM --platform=linux/amd64 node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json tailwind.config.js postcss.config.js ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# No REACT_APP_* values are baked in at build time. This image runs `npm
# start` at container startup, so react-scripts reads REACT_APP_* from the
# environment at that point — they're injected at container runtime (ECS
# task definition environment, or docker-compose environment section), so
# the same image runs unmodified across environments.
ENV HOST=0.0.0.0
ENV PORT=3000

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Change ownership of the app directory
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

# Use exec form for proper signal handling
CMD ["npm", "start"]
#CMD ["npm", "start", "--", "--host", "0.0.0.0"]