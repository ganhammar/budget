#!/usr/bin/env bash
# Starts DynamoDB Local and creates the table. Safe to re-run.
set -euo pipefail

NAME=budget-dynamodb
PORT="${DYNAMODB_PORT:-8042}"

if [ -n "$(docker ps -q --filter "name=^${NAME}$")" ]; then
  echo "DynamoDB Local already running on port ${PORT}."
else
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p "${PORT}:8000" \
    amazon/dynamodb-local:latest \
    -jar DynamoDBLocal.jar -sharedDb -inMemory >/dev/null
  echo "Started DynamoDB Local on port ${PORT}."
  sleep 2
fi

DYNAMODB_ENDPOINT="http://localhost:${PORT}" "$(dirname "$0")/create-local-table.sh"
