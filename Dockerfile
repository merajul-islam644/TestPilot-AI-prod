FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ARG ci_build=dev
ARG VITE_BLOCKS_API_URL
ARG VITE_BLOCKS_PROJECT_KEY
ARG VITE_BLOCKS_X_BLOCKS_KEY
ARG VITE_BLOCKS_APP_DOMAIN
ARG VITE_BLOCKS_OIDC_URL=https://iam.seliseblocks.com
ARG VITE_BLOCKS_OIDC_CLIENT_ID
ARG VITE_BLOCKS_OIDC_SCOPE="openid profile"
ARG VITE_BLOCKS_REDIRECT_URI
ARG VITE_BLOCKS_HOSTED_LOGIN=true

ENV VITE_BLOCKS_API_URL=${VITE_BLOCKS_API_URL}
ENV VITE_BLOCKS_PROJECT_KEY=${VITE_BLOCKS_PROJECT_KEY}
ENV VITE_BLOCKS_X_BLOCKS_KEY=${VITE_BLOCKS_X_BLOCKS_KEY}
ENV VITE_BLOCKS_APP_DOMAIN=${VITE_BLOCKS_APP_DOMAIN}
ENV VITE_BLOCKS_OIDC_URL=${VITE_BLOCKS_OIDC_URL}
ENV VITE_BLOCKS_OIDC_CLIENT_ID=${VITE_BLOCKS_OIDC_CLIENT_ID}
ENV VITE_BLOCKS_OIDC_SCOPE=${VITE_BLOCKS_OIDC_SCOPE}
ENV VITE_BLOCKS_REDIRECT_URI=${VITE_BLOCKS_REDIRECT_URI}
ENV VITE_BLOCKS_HOSTED_LOGIN=${VITE_BLOCKS_HOSTED_LOGIN}

RUN NODE_OPTIONS="--max-old-space-size=4096" npx vite build --mode "${ci_build}" \
  && node scripts/write-release-env.mjs "${ci_build}"

FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD wget -qO- http://localhost:8080/ || exit 1
