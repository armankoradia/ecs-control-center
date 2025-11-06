# Use multi-platform base image
FROM --platform=linux/amd64 node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json tailwind.config.js postcss.config.js ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build arguments for environment variables
ARG REACT_APP_OKTA_ISSUER
ARG REACT_APP_OKTA_CLIENT_ID
ARG REACT_APP_OKTA_REDIRECT_URI
ARG REACT_APP_API_BASE

# Set environment variables
ENV REACT_APP_OKTA_ISSUER=$REACT_APP_OKTA_ISSUER
ENV REACT_APP_OKTA_CLIENT_ID=$REACT_APP_OKTA_CLIENT_ID
ENV REACT_APP_OKTA_REDIRECT_URI=$REACT_APP_OKTA_REDIRECT_URI
ENV REACT_APP_API_BASE=$REACT_APP_API_BASE
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