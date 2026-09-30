#!/bin/sh
set -eu

if [ -n "${BMEC_POSTGRES_URL_FILE:-}" ]; then
  if [ ! -r "$BMEC_POSTGRES_URL_FILE" ]; then
    echo "BMEC_POSTGRES_URL_FILE is not readable" >&2
    exit 1
  fi
  BMEC_POSTGRES_URL=$(cat "$BMEC_POSTGRES_URL_FILE")
  if [ -z "$BMEC_POSTGRES_URL" ]; then
    echo "BMEC PostgreSQL URL secret is empty" >&2
    exit 1
  fi
  export BMEC_POSTGRES_URL
  unset BMEC_POSTGRES_URL_FILE
fi

exec node /app/node_modules/bmec/dist/cli/index.js "$@"
