ts=$(date -u +"%Y%m%dT%H%M%SZ")
out="/tmp/linear_${ts}"

curl -sS -D "${out}.headers" -o "${out}.body" \
  https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: $LINEAR_API_KEY" \
  --data '{"query":"query { viewer { id name email } }"}' \
  || echo "curl_failed"

echo "== status line =="
head -n 1 "${out}.headers"

echo "== key headers =="
grep -iE '^(x-request-id|cf-ray|x-ratelimit|x-complexity|retry-after):' "${out}.headers" || true

echo "== body =="
cat "${out}.body"

