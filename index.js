'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GovEsbHelper } = require('govesb-connector-js');

(async () => {
	// Load meaningful NIDA-style payload
	const payloadPath = path.join(__dirname, 'nida_sample.json');
	const payload = fs.readFileSync(payloadPath, 'utf8');

	// Generate keys for demo (prime256v1)
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const privateDerB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
	const publicDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

	// Create helper with keys (no live ESB calls here)
	const helper = new GovEsbHelper({
		clientPrivateKey: privateDerB64,
		esbPublicKey: publicDerB64
	});

	// 1) Sign + verify a response with the NIDA payload embedded
	const response = await helper.successResponse(payload, 'json');
	console.log('Signed response (truncated):', response.slice(0, 160) + '...');

	const verified = helper.verifyThenReturnData(response, 'json');
	console.log('Verified data present:', Boolean(verified));

	// 2) Encrypt + decrypt the NIDA payload
	const encrypted = helper.encrypt(payload, publicDerB64);
	console.log('Encrypted blob (truncated):', encrypted.slice(0, 160) + '...');

	const decrypted = helper.decrypt(encrypted);
	console.log('Decrypted equals original:', decrypted === payload);

	// Optionally write artifacts
	const outDir = path.join(__dirname, 'out');
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	fs.writeFileSync(path.join(outDir, 'encrypted.json'), encrypted);
	fs.writeFileSync(path.join(outDir, 'decrypted.json'), decrypted);
	console.log('Wrote out/encrypted.json and out/decrypted.json');

	// STEP 1: Build esbBody as the encrypted payload (what you would send)
	const esbBodyEncrypted = JSON.parse(encrypted);
	fs.writeFileSync(path.join(outDir, 'esbBody.encrypted.json'), JSON.stringify(esbBodyEncrypted, null, 2));
	console.log('Wrote out/esbBody.encrypted.json (this is the esbBody).');

	// Optional: Sign payloads using the package helper (requires govesb-connector-js >= 0.1.1)
	try {
		const payloadSignature = helper.signPayload(payload);
		const payloadVerifyOk = helper.verifySignature(payload, payloadSignature);
		fs.writeFileSync(path.join(outDir, 'payload.signature.b64.txt'), payloadSignature);
		console.log('Signed raw payload. Verified:', payloadVerifyOk);

		const esbBodySignature = helper.signPayload(esbBodyEncrypted);
		const esbBodyVerifyOk = helper.verifySignature(esbBodyEncrypted, esbBodySignature);
		fs.writeFileSync(path.join(outDir, 'esbBody.signature.b64.txt'), esbBodySignature);
		console.log('Signed esbBody payload. Verified:', esbBodyVerifyOk);
	} catch (e) {
		console.log('signPayload/verifySignature not available in installed package. Upgrade to govesb-connector-js >= 0.1.1');
	}

	// STEP 2: Send as a normal payload (offline demo prints the body you'd pass to requestData)
	// In live mode, you'd do:
	// await helper.requestData('YOUR_API_CODE', JSON.stringify(esbBodyEncrypted), 'json')
	// Here we just persist the payload you would pass as requestBody:
	fs.writeFileSync(path.join(outDir, 'request.payload.json'), JSON.stringify(esbBodyEncrypted, null, 2));
	console.log('Wrote out/request.payload.json (requestBody to pass to requestData in JSON mode).');

	// OPTIONAL: Sign the request payload using helper.signPayload to produce ESB-style wrapper
	const esbRequestDataString = JSON.stringify(esbBodyEncrypted);
	const signatureB64 = helper.signPayload(esbRequestDataString);
	const signedRequest = { data: esbBodyEncrypted, signature: signatureB64 };

	// Verify locally before sending
	const verifiedOk = helper.verifyPayload(esbRequestDataString, signatureB64);
	console.log('Signed request verifies:', verifiedOk);

	fs.writeFileSync(path.join(outDir, 'request.signed.json'), JSON.stringify(signedRequest, null, 2));
	console.log('Wrote out/request.signed.json (ESB-style signed wrapper).');
})().catch(err => {
	console.error(err);
	process.exit(1);
});


