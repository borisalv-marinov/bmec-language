FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS package-build

WORKDIR /src
COPY package.json package-lock.json ./
RUN apt-get update \
 && apt-get install --no-install-recommends -y python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && mkdir -p /tmp/bmec-package \
 && npm pack --pack-destination /tmp/bmec-package \
 && mv /tmp/bmec-package/bmec-0.9.1-beta.3.tgz /tmp/bmec.tgz

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS package-install
WORKDIR /tmp/consumer
RUN apt-get update \
 && apt-get install --no-install-recommends -y python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY --from=package-build /tmp/bmec.tgz /tmp/bmec.tgz
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund /tmp/bmec.tgz \
 && rm /tmp/bmec.tgz

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime

ENV NODE_ENV=production \
    BMEC_PORT=3000 \
    BMEC_HOST=0.0.0.0 \
    BMEC_SECURITY_MODE=production \
    BMEC_AUTH_DEFAULT_POLICY=role:admin \
    BMEC_MAX_BODY_BYTES=1000000 \
    BMEC_MAX_HEADER_BYTES=16384

WORKDIR /app
COPY --from=package-install --chown=node:node /tmp/consumer/node_modules /app/node_modules
COPY --chown=node:node examples/data-explorer/main.pipe /app/main.pipe
COPY --chown=node:node --chmod=755 deployment/entrypoint.sh /usr/local/bin/bmec-entrypoint
RUN chown -R node:node /app
USER node
RUN ./node_modules/.bin/bmec check /app/main.pipe \
 && ./node_modules/.bin/bmec build /app/main.pipe --release \
 && mkdir -p /app/generated /app/.pipe

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/bmec-entrypoint"]
CMD ["run", "/app/main.pipe"]
