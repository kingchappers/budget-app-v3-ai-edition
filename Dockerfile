# Pinned by multi-arch index digest. node:24-bookworm-slim and caddy:2, resolved 2026-10-11; bump deliberately.
FROM caddy:2@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772 AS caddy

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# React Router prerenders the SPA shell through a local preview server; in the build container its address family and the client's disagree.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
# Placeholder values so the SPA build succeeds. They are never used: the container serves its own /config.json.
ENV VITE_AUTH0_DOMAIN=container.invalid VITE_AUTH0_CLIENT_ID=dummy VITE_AUTH0_AUDIENCE=https://container.invalid/api
# scripts/build-store-cli.cjs calls tsc from PATH (yarn adds node_modules/.bin; a plain node invocation does not).
ENV PATH=/app/node_modules/.bin:$PATH
RUN react-router build \
 && node scripts/build-store-cli.cjs \
 && node scripts/build-container.cjs \
 && rm -f build/client/config.json

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini libcap2-bin ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
# Lets the non-root user bind 80 and 443. Ignored by a platform that runs containers with no-new-privileges: use plain HTTP there.
# /data and /data/backups are created here, owned by the app user, so a fresh named volume mounted at either inherits that ownership.
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --home-dir /home/app --create-home app \
 && mkdir -p /data/backups \
 && chown 10001:10001 /data /data/backups
WORKDIR /app
COPY --from=build /app/build/client ./build/client
COPY --from=build /app/build/container ./build/container
COPY --from=build /app/build/store-cli ./build/store-cli

ENV NODE_ENV=production DATA_DIR=/data TZ=UTC
LABEL org.opencontainers.image.source="https://github.com/kingchappers/budget-app-v3-ai-edition" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.title="Budget app"
USER app
VOLUME /data
EXPOSE 80 443 443/udp 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "build/container/container/bin.js"]
