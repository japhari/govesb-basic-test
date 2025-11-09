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
