#!/usr/bin/env bash
# Creates the single table in DynamoDB Local. Safe to re-run.
set -euo pipefail

ENDPOINT="${DYNAMODB_ENDPOINT:-http://localhost:8042}"
TABLE="${TABLE_NAME:-budget}"

export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_DEFAULT_REGION=eu-north-1

if aws dynamodb describe-table --table-name "$TABLE" --endpoint-url "$ENDPOINT" >/dev/null 2>&1; then
  echo "Table '$TABLE' already exists."
  exit 0
fi

aws dynamodb create-table \
  --table-name "$TABLE" \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url "$ENDPOINT" \
  --no-cli-pager >/dev/null

echo "Created table '$TABLE'."
