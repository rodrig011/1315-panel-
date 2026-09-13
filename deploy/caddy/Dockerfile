FROM caddy:2.10.2-builder AS builder
RUN xcaddy build --with github.com/ueffel/caddy-brotli@v1.6.0

FROM caddy:2.10.2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
