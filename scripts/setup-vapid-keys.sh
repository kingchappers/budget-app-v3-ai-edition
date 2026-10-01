#!/usr/bin/env bash
# One-off setup for bill reminders: creates a VAPID key pair, stores the private half in AWS SSM
# and the public half as a GitHub Actions secret. Neither key is printed or written to disk (SEC-01).
#
# Needs: AWS credentials that may write SSM parameters in the region, `gh` signed in with
# permission to set repository secrets, and `yarn install` already run (it uses the web-push package).
#
# Usage: scripts/setup-vapid-keys.sh [--force]   (--force replaces keys that already exist)
set -euo pipefail

REGION="${AWS_REGION:-eu-west-2}"
PARAMETER="/budget-app/vapid-private-key"
SECRET="VAPID_PUBLIC_KEY"
FORCE="${1:-}"

cd "$(dirname "$0")/.."

for tool in node aws gh; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

if aws ssm get-parameter --name "$PARAMETER" --region "$REGION" >/dev/null 2>&1 && [ "$FORCE" != "--force" ]; then
  echo "$PARAMETER already exists in $REGION. Replacing it would stop reminders for every installed device." >&2
  echo "Run again with --force if that is what you want." >&2
  exit 1
fi

KEYS="$(node --input-type=module -e "
import webpush from 'web-push';
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
process.stdout.write(publicKey + ' ' + privateKey);
")"
PUBLIC_KEY="${KEYS%% *}"
PRIVATE_KEY="${KEYS##* }"

# The key goes in on stdin so it never shows in the process list.
printf '%s' "$PRIVATE_KEY" | aws ssm put-parameter \
  --name "$PARAMETER" \
  --type SecureString \
  --value file:///dev/stdin \
  --overwrite \
  --region "$REGION" >/dev/null
echo "Stored the private key as $PARAMETER in $REGION."

printf '%s' "$PUBLIC_KEY" | gh secret set "$SECRET"
echo "Set the GitHub secret $SECRET."

echo "Next: re-run the main deploy so the build and OpenTofu pick up the public key."
