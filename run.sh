#!/bin/bash

VITE_OPENAI_API_KEY=$(curl -s -X POST https://api.openai.com/v1/realtime/client_secrets \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session": {"type": "realtime", "model": "gpt-realtime"}}' \
  | jq -r .value)

VITE_OPENAI_API_KEY=$VITE_OPENAI_API_KEY npm run dev
