#!/usr/bin/env bash
# Sets Supabase Auth to send 6-digit codes (not links) and fixes the site/redirect URLs.
# Needs a personal access token: https://supabase.com/dashboard/account/tokens
set -euo pipefail
REF=lnspwuepxdlhgvcdwrte
TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN first}"

BODY='<h2>Your FitOS code</h2><p>Enter this code in the app:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p><p>It expires in 1 hour.</p>'

curl -sS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; b=sys.argv[1]; print(json.dumps({
    "site_url": "https://fitos.pages.dev",
    "uri_allow_list": "https://fitos.pages.dev/**,http://localhost:3000/**",
    "mailer_otp_length": 6,
    "mailer_subjects_magic_link": "Your FitOS code",
    "mailer_subjects_confirmation": "Your FitOS code",
    "mailer_templates_magic_link_content": b,
    "mailer_templates_confirmation_content": b,
    "external_email_enabled": True,
  }))' "$BODY")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("error:", d) if "message" in d else print("Auth updated. OTP length:", d.get("mailer_otp_length"), "| site:", d.get("site_url"))'
