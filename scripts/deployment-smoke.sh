#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bmec-phase8.XXXXXXXX")"
PROJECT="bmec-phase8-$(openssl rand -hex 4)"
PASSWORD_FILE="$TEMP_DIR/postgres_password"
URL_FILE="$TEMP_DIR/postgres_url"
ENV_FILE="$TEMP_DIR/compose.env"
EVIDENCE_PATH="${BMEC_DEPLOYMENT_EVIDENCE:-$ROOT/output/deployment-smoke.json}"
COMPOSE=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" --file "$ROOT/compose.yaml")

cleanup() {
  status=$?
  "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$TEMP_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for command in docker openssl python3 curl; do
  command -v "$command" >/dev/null || { echo "Required command is missing: $command" >&2; exit 1; }
done
docker compose version >/dev/null
docker info >/dev/null

HOST_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
SMOKE_USER="phase8-$(openssl rand -hex 4)"
SMOKE_PASSWORD="$(openssl rand -hex 16)"
SMOKE_ORIGIN="http://127.0.0.1:${HOST_PORT}"
printf '%s\n' "$POSTGRES_PASSWORD" > "$PASSWORD_FILE"
printf 'postgres://bmec:%s@db:5432/bmec\n' "$POSTGRES_PASSWORD" > "$URL_FILE"
chmod 0400 "$PASSWORD_FILE"
chown 1000:1000 "$URL_FILE"
chmod 0400 "$URL_FILE"
cat > "$ENV_FILE" <<ENV
POSTGRES_DB=bmec
POSTGRES_USER=bmec
POSTGRES_PASSWORD_SECRET_FILE=$PASSWORD_FILE
BMEC_POSTGRES_URL_SECRET_FILE=$URL_FILE
BMEC_HOST_BIND_ADDRESS=127.0.0.1
BMEC_HOST_PORT=$HOST_PORT
BMEC_SECURITY_MODE=production
BMEC_AUTH_DEFAULT_POLICY=role:admin
BMEC_ALLOWED_ORIGINS=$SMOKE_ORIGIN
ENV
chmod 0600 "$ENV_FILE"
export SMOKE_USER SMOKE_PASSWORD SMOKE_ORIGIN

echo "Building the clean BMEC package image and starting local PostgreSQL..."
"${COMPOSE[@]}" up --build --detach --wait --wait-timeout 240
wait_for_http() {
  path=$1
  for attempt in $(seq 1 45); do
    if curl --fail --silent "$SMOKE_ORIGIN$path" >/dev/null; then return 0; fi
    sleep 1
  done
  echo "BMEC did not answer $path on the published local port" >&2
  return 1
}
wait_for_http /healthz
wait_for_http /readyz

SMOKE_COOKIE="$("${COMPOSE[@]}" exec --no-TTY \
  -e SMOKE_ORIGIN="$SMOKE_ORIGIN" -e SMOKE_USER="$SMOKE_USER" -e SMOKE_PASSWORD="$SMOKE_PASSWORD" \
  app node --input-type=module <<'NODE'
const origin = process.env.SMOKE_ORIGIN;
const base = 'http://127.0.0.1:3000';
for (const endpoint of ['/healthz', '/readyz']) {
  const response = await fetch(base + endpoint);
  if (response.status !== 200) throw new Error(`${endpoint} returned ${response.status}`);
}
const registration = await fetch(base + '/auth/register', {
  method: 'POST',
  headers: {'content-type': 'application/json', origin},
  body: JSON.stringify({id: process.env.SMOKE_USER, password: process.env.SMOKE_PASSWORD}),
});
if (registration.status !== 201) throw new Error(`Registration returned ${registration.status}`);
const login = await fetch(base + '/auth/login', {
  method: 'POST', headers: {'content-type': 'application/json', origin},
  body: JSON.stringify({id: process.env.SMOKE_USER, password: process.env.SMOKE_PASSWORD}),
});
if (login.status !== 200) throw new Error(`Login returned ${login.status}`);
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie) throw new Error('Login did not issue a session cookie');
console.log(cookie);
NODE
)"

SQL="UPDATE bmec_users SET attributes = '{\"role\":\"admin\"}' WHERE id = '${SMOKE_USER}'"
"${COMPOSE[@]}" exec --no-TTY db psql -v ON_ERROR_STOP=1 -U bmec -d bmec -c "$SQL" >/dev/null
"${COMPOSE[@]}" exec --no-TTY db psql -v ON_ERROR_STOP=1 -U bmec -d bmec \
  -c 'INSERT INTO "Region" (name) VALUES ('"'"'Region 1'"'"') ON CONFLICT (name) DO NOTHING' >/dev/null

"${COMPOSE[@]}" exec --no-TTY \
  -e SMOKE_ORIGIN="$SMOKE_ORIGIN" -e SMOKE_COOKIE="$SMOKE_COOKIE" \
  app node --input-type=module <<'NODE'
const origin = process.env.SMOKE_ORIGIN;
const cookie = process.env.SMOKE_COOKIE;
const created = await fetch('http://127.0.0.1:3000/records', {
  method: 'POST',
  headers: {'content-type': 'application/json', origin, cookie},
  body: JSON.stringify({name: 'Phase 8 container record', category: 'Smoke', region: 1, value: 8, active: true}),
});
if (created.status !== 200) throw new Error(`Create returned ${created.status}: ${await created.text()}`);
const ready = await fetch('http://127.0.0.1:3000/readyz');
if (ready.status !== 200) throw new Error(`Readiness returned ${ready.status}`);
NODE

echo "Stopping the app and database containers while keeping the named database volume..."
"${COMPOSE[@]}" stop --timeout 30 app db
APP_CONTAINER_ID="$("${COMPOSE[@]}" ps --all --quiet app)"
APP_EXIT_CODE="$(docker inspect --format '{{.State.ExitCode}}' "$APP_CONTAINER_ID")"
if [ "$APP_EXIT_CODE" != 0 ]; then echo "BMEC did not exit cleanly on SIGTERM (exit $APP_EXIT_CODE)" >&2; exit 1; fi
"${COMPOSE[@]}" down --remove-orphans
"${COMPOSE[@]}" up --detach --wait --wait-timeout 120

POSTGRES_VERSION="$("${COMPOSE[@]}" exec --no-TTY db psql -v ON_ERROR_STOP=1 -U bmec -d bmec -tA -c 'SHOW server_version' | tr -d '\r')"
NODE_VERSION="$("${COMPOSE[@]}" exec --no-TTY app node --version | tr -d '\r')"
WSL_KERNEL="$(uname -r)"
export POSTGRES_VERSION NODE_VERSION WSL_KERNEL APP_EXIT_CODE SMOKE_ORIGIN SMOKE_COOKIE
PERSISTENCE_OUTPUT="$("${COMPOSE[@]}" exec --no-TTY -e SMOKE_ORIGIN="$SMOKE_ORIGIN" -e SMOKE_COOKIE="$SMOKE_COOKIE" app node --input-type=module <<'NODE'
const cookie = process.env.SMOKE_COOKIE;
for (const endpoint of ['/healthz', '/readyz']) {
  const response = await fetch('http://127.0.0.1:3000' + endpoint);
  if (response.status !== 200) throw new Error(`After restart ${endpoint} returned ${response.status}`);
}
const page = await fetch('http://127.0.0.1:3000/records/page', {headers: {cookie}});
if (page.status !== 200) throw new Error(`Post-restart page returned ${page.status}`);
const rows = await page.json();
if (!rows.some(row => row.name === 'Phase 8 container record')) throw new Error('Application record did not survive the app and database container restart');
console.log(`PERSISTENCE_PASS rows=${rows.length}`);
NODE
)"
printf '%s\n' "$PERSISTENCE_OUTPUT"
PHASE8_ROWS="${PERSISTENCE_OUTPUT##*rows=}"
export PHASE8_ROWS

APP_IMAGE_ID="$("${COMPOSE[@]}" images --quiet app | head -n 1)"
export APP_IMAGE_ID
python3 - "$EVIDENCE_PATH" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

evidence = {
  'gate': 'BMEC_0_8_PHASE_8_LOCAL_CONTAINER',
  'recordedAt': datetime.now(timezone.utc).isoformat(),
  'environment': {'platform': 'WSL2 Ubuntu', 'kernel': os.environ['WSL_KERNEL'], 'node': os.environ['NODE_VERSION'], 'postgres': os.environ['POSTGRES_VERSION']},
  'images': {'app': os.environ['APP_IMAGE_ID'], 'nodeBase': 'node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d', 'postgresBase': 'postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650'},
  'checks': {'cleanPackageInstalled': True, 'productionBuild': True, 'postgresConnected': True, 'authenticatedWrite': True, 'appAndDatabaseContainersRestarted': True, 'sessionAndApplicationDataPersisted': True, 'healthz': 200, 'readyz': 200, 'gracefulAppExitCode': int(os.environ['APP_EXIT_CODE'])},
  'data': {'persistedRecordName': 'Phase 8 container record', 'rowsReturnedAfterRestart': int(os.environ.get('PHASE8_ROWS', '0'))},
  'limitations': ['Local WSL2 container evidence only; no external production deployment, TLS edge, or failover claim.'],
}
path = Path(sys.argv[1]).resolve()
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
print(json.dumps(evidence, indent=2))
PY
