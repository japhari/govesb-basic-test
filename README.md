# govesb-basic

Minimal, realistic example that shows how to use `govesb-connector-js` with a JSON payload.

## What this example does

- Loads `nida_sample.json` (illustrative NIDA-like record)
- Generates an EC keypair (prime256v1) at runtime
- Signs and verifies a JSON response containing the payload
- Encrypts the payload and decrypts it back
- Writes outputs to `out/encrypted.json` and `out/decrypted.json`

## Requirements

- Node.js >= 18

## Quick start

```bash
cd govesb-basic
npm i
npm start
```

You should see:

- Signed response printed (truncated)
- Verification result: `true`
- Encrypted blob printed (truncated)
- Decryption check: `true`

Artifacts:

- `govesb-basic/out/encrypted.json` (JSON with `ephemeralKey`, `iv`, `encryptedData`)
- `govesb-basic/out/decrypted.json` (plaintext JSON matching `nida_sample.json`)

## Folder structure

- `index.js` — demo script (sign, verify, encrypt, decrypt)
- `nida_sample.json` — sample payload used by the demo
- `out/` — artifacts written by the demo
- `server.js` — HTTP server mirroring `EsbLocalTestController.java` endpoints

## Encrypt esbBody and send as normal payload

This is a common pattern:

- Step 1 (encrypt the payload to become `esbBody`):
  - The demo writes `out/esbBody.encrypted.json`. This object contains `ephemeralKey`, `iv`, and `encryptedData` (tag first, then ciphertext).
- Step 2 (send as normal payload):
  - When using JSON, call:
    - `await helper.requestData('YOUR_API_CODE', JSON.stringify(esbBodyEncrypted), 'json')`
  - In this example we persist the payload you would pass as `requestBody` to `out/request.payload.json`.

## Customize

- Edit `nida_sample.json` to test other payloads.
- Replace the generated ephemeral keys with your real keys by providing:
  - `clientPrivateKey` (base64 PKCS#8 DER, no PEM headers)
  - `esbPublicKey` (base64 X.509 DER)

Example snippet in `index.js` (replace the generated keys):

```js
const helper = new GovEsbHelper({
  clientPrivateKey: process.env.GOVESB_CLIENT_PRIVATE_KEY,
  esbPublicKey: process.env.GOVESB_PUBLIC_KEY,
});
```

## Notes

- Encryption uses ECDH + HKDF‑SHA256 (salt=32 zero bytes, info="aes-encryption") → AES‑256‑GCM.
- `encryptedData` contains the 16‑byte GCM tag followed by ciphertext (tag first).
- This example is offline; no ESB endpoints are called.

## HTTP Server (Node) – ESB Test Endpoints

A small Express server is included to mirror the Java `EsbLocalTestController` routes.

### Run the server

```bash
npm run serve
```

Server listens on `http://0.0.0.0:7777`. Health check: `GET /health`.

### .env configuration (PEM or values)

Create a `.env` file in this folder with your real configuration. You can provide PEM file paths or raw PEM content; the server will convert them to base64 DER internally.

```bash
# Keys (PEM paths recommended)
CLIENT_PRIVATE_KEY=privateKey.pem
GOVESB_PUBLIC_KEY=publicKey.pem

# OAuth client credentials for GovESB UAA
CLIENT_ID=d7aefda9-0350-11ed-9b80-c90d599fe3db
CLIENT_SECRET=Q1zrniEopLP7H0YbLDPCzzrLnmTDjfkO
ACCESS_TOKEN_URL=https://govesb.gov.go.tz/gw/govesb-uaa/oauth/token

# GovESB endpoints
PUSH_REQUEST=https://govesb.gov.go.tz/engine/esb/push-request
RESPONSE_REQUEST=https://govesb.gov.go.tz/engine/esb/request
ASYNC_REQUEST=https://govesb.gov.go.tz/engine/esb/async

# Optional defaults
GOVESB_API_CODE=H0RiaUnK
DEFAULT_RECIPIENT_PUBLIC_KEY=BASE64_X509_SPKI_PUBLIC  # optional fallback
```

Notes:

- You can also set `CLIENT_PRIVATE_KEY` and `GOVESB_PUBLIC_KEY` to the raw PEM contents or base64 DER strings. PEM paths are easiest.
- If not provided, the server generates an ephemeral EC key pair for local testing only.

### Endpoints

- `POST /esb-test/php-producer`

  - Calls `requestData('H0RiaUnK', body, 'json')` using `govesb-connector-js`.
  - Body: JSON or raw JSON string.
  - Response: whatever the helper returns.

- `POST /esb-test/esb-dummy-route`

  - Proxies the body to `http://0.0.0.0:7777/esb/dummy-route` with `Content-Type: application/json`.
  - Useful for local manual testing of a downstream receiver.

- `POST /esb-test/producer-sync-test`

  - Verifies signature via `verifyThenReturnData`.
  - Decrypts incoming `esbBody`, then returns an encrypted response.
  - Response body is dynamic:
    - If the verified payload contains `responseBody` (or `reply`), that value is used.
    - Otherwise the decrypted plaintext is echoed back.
  - Recipient public key is selected in order:
    1. `esbBody.encryptionKey` (from the incoming `esbBody`)
    2. `recipientPublicKey` from the verified payload
    3. `X-Recipient-Public-Key` header
    4. `DEFAULT_RECIPIENT_PUBLIC_KEY` env var

- `POST /esb-test/consumer-sync-test`

  - Verifies signature via `verifyThenReturnData`, encrypts a caller-provided payload with a provided recipient public key, returns `successResponse(...)`.
  - No hardcoded payload. The server expects a plaintext payload to encrypt:
    - Provide as `esbBody`, `payload`, or `data` in the verified payload; or in the request body if not in the verified payload.
  - Recipient public key order:
    1. `recipientPublicKey` in the verified payload
    2. `recipientPublicKey` in the request body
    3. `X-Recipient-Public-Key` header
    4. `DEFAULT_RECIPIENT_PUBLIC_KEY` env var

- `POST /esb-test/push-test`

  - Calls `pushData('MOXEV', body, 'json')` if available in the installed helper version; otherwise returns HTTP 501.

- `POST /esb-test/push-test-receive`
  - Verifies incoming body via `verifyThenReturnData` and responds with `successResponse({"success": true, "message": "Received"})`.

### Example: Signed request wrapper

If you have an ESB-style signed wrapper like:

```json
{
  "data": {
    "esbBody": { "ephemeralKey": "...", "iv": "...", "encryptedData": "..." },
    "responseBody": { "any": "json" }, // optional, producer-sync-test response override
    "recipientPublicKey": "BASE64_DER_SPKI" // optional when not present in esbBody.encryptionKey
  },
  "signature": "BASE64_SIGNATURE"
}
```

Send it as the request body to the `producer-sync-test` or `consumer-sync-test` endpoints. The server will verify, then proceed with decrypt/encrypt as described above.

## Environment Variables

- `GOVESB_CLIENT_PRIVATE_KEY` — base64 PKCS#8 DER private key of the client
- `GOVESB_PUBLIC_KEY` — base64 X.509 SPKI DER ESB public key
- `GOVESB_API_CODE` — API code for `/esb-test/php-producer` (defaults to `H0RiaUnK`)
- `DEFAULT_RECIPIENT_PUBLIC_KEY` — fallback recipient key if not supplied in requests
- or use:
  - `CLIENT_PRIVATE_KEY` — path to PEM or PEM content (private)
  - `GOVESB_PUBLIC_KEY` — path to PEM or PEM content (public)
  - `CLIENT_ID`, `CLIENT_SECRET`, `ACCESS_TOKEN_URL` — OAuth credentials
  - `PUSH_REQUEST`, `RESPONSE_REQUEST`, `ASYNC_REQUEST` — ESB endpoints

The server automatically loads `.env` (via `dotenv`) and converts PEM files/strings to base64 DER for the helper.

## cURL examples

Health:

```bash
curl -s http://0.0.0.0:7777/health
```

PHP producer (forwards to requestData with `GOVESB_API_CODE`):

```bash
curl -s -X POST http://0.0.0.0:7777/esb-test/php-producer \
  -H 'Content-Type: application/json' \
  --data-binary @out/request.payload.json
```

Producer sync (echo decrypted encrypted back):

```bash
curl -s -X POST http://0.0.0.0:7777/esb-test/producer-sync-test \
  -H 'Content-Type: application/json' \
  --data-binary '{
    "data": {
      "esbBody": {
        "ephemeralKey": "...",
        "iv": "...",
        "encryptedData": "..."
      }
    },
    "signature": "BASE64_SIGNATURE"
  }'
```

Producer sync (custom responseBody and explicit recipient key via header):

```bash
curl -s -X POST http://0.0.0.0:7777/esb-test/producer-sync-test \
  -H 'Content-Type: application/json' \
  -H 'X-Recipient-Public-Key: BASE64_SPKI' \
  --data-binary '{
    "data": {
      "esbBody": {
        "ephemeralKey": "...",
        "iv": "...",
        "encryptedData": "..."
      },
      "responseBody": { "status": "ok" }
    },
    "signature": "BASE64_SIGNATURE"
  }'
```

Consumer sync (encrypt provided payload, recipient key in body):

```bash
curl -s -X POST http://0.0.0.0:7777/esb-test/consumer-sync-test \
  -H 'Content-Type: application/json' \
  --data-binary '{
    "data": {
      "payload": { "amount": "123.45", "currency": "TZS" },
      "recipientPublicKey": "BASE64_SPKI"
    },
    "signature": "BASE64_SIGNATURE"
  }'
```

Consumer sync (recipient key via header, payload outside verified wrapper):

```bash
curl -s -X POST http://0.0.0.0:7777/esb-test/consumer-sync-test \
  -H 'Content-Type: application/json' \
  -H 'X-Recipient-Public-Key: BASE64_SPKI' \
  --data-binary '{
    "data": {},
    "esbBody": { "reference": "abc123", "status": "PENDING" }
  }'
```

Push test:

```bash
curl -s -X POST http://0.0.0.0:7777/esb-test/push-test \
  -H 'Content-Type: application/json' \
  --data-binary '{"any":"payload"}'
```

Push test receive:

```bash
curl -s -X POST http://0.0.0.0:7777/esb-test/push-test-receive \
  -H 'Content-Type: application/json' \
  --data-binary '{"data":{"foo":"bar"},"signature":"BASE64_SIGNATURE"}'
```

## Convert PEM → base64 DER

```bash
# Private (PKCS#8 DER → base64)
openssl pkcs8 -topk8 -nocrypt -in private.pem -outform DER | base64

# Public (X.509 SPKI DER → base64)
openssl pkey -pubin -in public.pem -outform DER | base64
```

## Troubleshooting

- If Node < 18, provide your own `fetch` to the helper or upgrade Node.
- If decryption fails, ensure P‑256 is used and HKDF parameters match exactly.
- Ensure keys are base64‑encoded DER (not raw PEM strings).
