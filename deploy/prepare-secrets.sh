#!/usr/bin/env bash
# ==============================================================================
# REV-220: turns the secret lines of .env.production into Docker secret files
# ==============================================================================
# Usage: deploy/prepare-secrets.sh <env-file> <secrets-dir> <runtime-env-file>
#
# - writes one file per secret into <secrets-dir> (mode 444 in a 700 directory): jwt_secret, mongodb_uri,
#   s3_secret_key, redis_url, redis_password. docker-compose.prod.yml mounts them under /run/secrets and the apps
#   read them through the JWT_SECRET_FILE, MONGODB_URI_FILE ... variables.
# - writes <runtime-env-file>: the env file without those lines, so the secrets are not in the container environment
#   (`docker inspect` shows no value). deploy.sh passes it to compose as ENV_FILE.
# An unset secret gets an empty file: the app treats an empty value as "not set", exactly as before.
set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <env-file> <secrets-dir> <runtime-env-file>" >&2
    exit 2
fi

ENV_FILE="$1"
SECRETS_DIR="$2"
RUNTIME_ENV_FILE="$3"
SECRET_KEYS=(JWT_SECRET MONGODB_URI S3_SECRET_KEY REDIS_URL REDIS_PASSWORD)

if [ ! -f "${ENV_FILE}" ]; then
    echo "env file not found: ${ENV_FILE}" >&2
    exit 1
fi

umask 077
mkdir -p "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

# The last assignment of KEY wins, like in a shell; surrounding quotes are removed
value_of() {
    grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "${ENV_FILE}" | tail -n 1 \
        | sed -E "s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*//; s/[[:space:]]+\$//; s/^\"(.*)\"\$/\1/; s/^'(.*)'\$/\1/" || true
}

PATTERN=""
for key in "${SECRET_KEYS[@]}"; do
    file="${SECRETS_DIR}/$(echo "${key}" | tr '[:upper:]' '[:lower:]')"
    rm -f "${file}"
    printf '%s\n' "$(value_of "${key}")" > "${file}"
    chmod 444 "${file}"
    PATTERN="${PATTERN:+${PATTERN}|}${key}"
done

# `|| true`: grep -v exits 1 when every line was removed
grep -Ev "^[[:space:]]*(export[[:space:]]+)?(${PATTERN})[[:space:]]*=" "${ENV_FILE}" > "${RUNTIME_ENV_FILE}" || true
chmod 600 "${RUNTIME_ENV_FILE}"
