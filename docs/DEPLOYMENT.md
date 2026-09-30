# BMEC container deployment

This repository includes a reproducible Linux reference deployment for the
Data Explorer application. It builds and installs the BMEC 0.9.1-beta.2 npm
package inside a Node 24.18 Linux image, then runs it beside PostgreSQL 18.6.
The container base images are digest-pinned. PostgreSQL data uses a named
volume, and the runtime starts as the unprivileged `node` user.

The Compose file binds the app to `127.0.0.1:3000` by default and does not
publish the database port. Inside the container, the BMEC server listens on
`0.0.0.0` so Docker can forward traffic to it; set `BMEC_HOST` to choose
another interface. Put a trusted TLS reverse proxy in front of the loopback
listener for browser traffic. Set `BMEC_ALLOWED_ORIGINS` to the exact public
HTTPS origin; do not trust arbitrary forwarded host or scheme headers.
The reference deployment does not configure TLS, an Internet-facing firewall,
external monitoring, or database failover.

## Prepare secrets and configuration

Run these steps from the repository root on Linux, including WSL. Keep
`deploy-secrets/` private; it is excluded from Git and the Docker build
context. Local Compose file secrets are bind-mounted, so the PostgreSQL URL
file must be readable by the app container's UID 1000. Use a production secret
manager for hosted environments.

```sh
cp .env.example .env
mkdir -p deploy-secrets
chmod 700 deploy-secrets
umask 077
openssl rand -hex 32 > deploy-secrets/postgres_password
DB_PASSWORD="$(cat deploy-secrets/postgres_password)"
printf 'postgres://bmec:%s@db:5432/bmec\n' "$DB_PASSWORD" > deploy-secrets/postgres_url
unset DB_PASSWORD
chmod 400 deploy-secrets/postgres_password deploy-secrets/postgres_url
chown 1000:1000 deploy-secrets/postgres_url
```

Edit `.env` to set the public origin and host port. For local smoke testing,
the script supplies an ephemeral loopback origin and temporary database
secrets automatically. Do not put real passwords or database URLs in
`.env.example`, source files, image build arguments, or browser bundles.

The default authorization policy requires the `admin` role. Register users
through `/auth/register`, then grant elevated roles only through a trusted
operator-controlled process. The supported insert-only `BMEC_AUTH_USERS`
startup seed is also available to a secret manager; it does not replace an
existing password or role. Do not bake user credentials into the image.

## Build and run

```sh
docker compose --env-file .env up --build --detach --wait
docker compose ps
curl --fail http://127.0.0.1:3000/healthz
curl --fail http://127.0.0.1:3000/readyz
```

The image installs the packed BMEC package in a clean consumer directory,
checks the example app, and produces a release build during image creation.
At startup the BMEC runtime applies safe additive model migrations and checks
PostgreSQL readiness. The `/healthz` endpoint reports process liveness;
`/readyz` also checks the selected database. The application entrypoint uses
`exec`, so Docker signals reach BMEC's graceful shutdown handler.

## Upgrade, backup, and recovery

Build an updated app image from the reviewed BMEC source and run
`docker compose --env-file .env up --build --detach --wait`. PostgreSQL
migrations run transactionally at application startup. Back up PostgreSQL
with the host's supported database tooling before an upgrade and retain a
known-good restore point. See the [database production guide](DATABASE_PRODUCTION.md)
for the safe-additive migration boundary and recovery checks.

The named `postgres_data` volume survives `docker compose down` and container
recreation. **Do not use `docker compose down --volumes` for routine upgrades
or recovery:** it deletes the database volume. Restore a verified backup to an
isolated target, confirm its migration ledger and application data, and switch
traffic only after readiness and application checks pass. This Compose setup
does not automate backup retention or point-in-time recovery.

## Local Linux verification

From a Linux host or WSL distribution with systemd and Docker Compose enabled,
run:

```sh
npm run test:deployment
```

The smoke gate builds the clean package image, starts an isolated PostgreSQL
container, checks production-mode health and readiness, registers and
authenticates a test user, performs an authorized model write, stops and
recreates both containers while retaining the named volume, and verifies the
session and application row after restart. It then removes only its
run-specific containers and volume. The gate also writes a machine-readable
local report.

This is local WSL/Linux evidence. It does not prove an external production
deployment, a TLS edge, high availability, or an independent security audit.
