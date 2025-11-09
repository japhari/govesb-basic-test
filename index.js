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
})().catch(err => {
	console.error(err);
	process.exit(1);
});


