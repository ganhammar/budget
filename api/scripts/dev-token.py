#!/usr/bin/env python3
"""
Mints a session cookie for local development, so the app can be used without
going through Google.

This is deliberately a script rather than an endpoint. The API derives its signing
key from a fixed string only when SESSION_SECRET_ARN is unset, which is true
locally and never true in the deployed stack, where the key comes from Secrets
Manager. So there is no code path in the running application that can be tricked
into issuing a session, and nothing here can accidentally ship.

    ./api/scripts/dev-token.py                     # defaults to ganhammar@gmail.com
    ./api/scripts/dev-token.py petra@example.com
"""
import base64
import hashlib
import hmac
import json
import sys
import time

# Must match SessionTokens.DevKey in the API.
DEV_KEY_SEED = "budget-dev-key:local"
ISSUER = "budget"
DAYS = 30


def b64(raw: bytes) -> bytes:
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


def mint(email: str) -> str:
    key = hashlib.sha256(DEV_KEY_SEED.encode()).digest()
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(json.dumps({
        "sub": email,
        "iss": ISSUER,
        "aud": ISSUER,
        "exp": int(time.time()) + DAYS * 86400,
    }, separators=(",", ":")).encode())
    signed = header + b"." + payload
    signature = b64(hmac.new(key, signed, hashlib.sha256).digest())
    return (signed + b"." + signature).decode()


def main() -> None:
    email = sys.argv[1] if len(sys.argv) > 1 else "ganhammar@gmail.com"
    token = mint(email)

    print(f"Session for {email}, valid {DAYS} days.\n")
    print("Browser (paste into the console on http://localhost:5173):")
    print(f'  document.cookie = "budget_session={token}; path=/"; location.reload()\n')
    print("curl:")
    print(f'  curl -b "budget_session={token}" http://localhost:5080/api/budget\n')
    print("Token:")
    print(f"  {token}")


if __name__ == "__main__":
    main()
