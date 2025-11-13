'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const { GovEsbHelper } = require('govesb-connector-js');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '2mb' }));

const RESOLVED_KEYS = { esbPublic: undefined };

// Helper initialization:
// Prefer environment keys if provided; otherwise generate an ephemeral keypair for local testing.
function initializeHelper() {
    const envPrivateAny = process.env.CLIENT_PRIVATE_KEY || process.env.GOVESB_CLIENT_PRIVATE_KEY;
    const envEsbPublicAny = process.env.GOVESB_PUBLIC_KEY;

    function resolvePrivateKeyBase64Der(value) {
        if (!value) return undefined;
        // If value looks like a path, or PEM content, convert to base64 DER
        let pemContent = null;
        const looksLikePath = typeof value === 'string' && (value.endsWith('.pem') || fs.existsSync(value));
        if (looksLikePath) {
            pemContent = fs.readFileSync(value, 'utf8');
        } else if (String(value).includes('-----BEGIN')) {
            pemContent = String(value);
        }
        if (pemContent) {
            const keyObj = crypto.createPrivateKey({ key: pemContent });
            return keyObj.export({ type: 'pkcs8', format: 'der' }).toString('base64');
        }
        // assume already base64 DER string
        return String(value);
    }

    function resolvePublicKeyBase64Der(value) {
        if (!value) return undefined;
        let pemContent = null;
        const looksLikePath = typeof value === 'string' && (value.endsWith('.pem') || fs.existsSync(value));
        if (looksLikePath) {
            pemContent = fs.readFileSync(value, 'utf8');
        } else if (String(value).includes('-----BEGIN')) {
            pemContent = String(value);
        }
        if (pemContent) {
            const keyObj = crypto.createPublicKey({ key: pemContent });
            return keyObj.export({ type: 'spki', format: 'der' }).toString('base64');
        }
        return String(value);
    }

    const resolvedPrivate = resolvePrivateKeyBase64Der(envPrivateAny);
    const resolvedPublic = resolvePublicKeyBase64Der(envEsbPublicAny);
    RESOLVED_KEYS.esbPublic = resolvedPublic;

    if (resolvedPrivate && resolvedPublic) {
        // Derive engine base URL from known endpoint envs if not explicitly provided
        const deriveEngineUrl = () => {
            const push = process.env.PUSH_REQUEST;
            const resp = process.env.RESPONSE_REQUEST;
            const asyn = process.env.ASYNC_REQUEST;
            const pick = push || resp || asyn || '';
            return pick
                .replace(/\/push-request\/?$/i, '')
                .replace(/\/request\/?$/i, '')
                .replace(/\/async\/?$/i, '');
        };
        const esbEngineUrl = deriveEngineUrl();
        const esbTokenUrl = process.env.ACCESS_TOKEN_URL;
        // Debug which fields are missing before constructing the helper
        const initNulls = {
            clientPrivateKey: !resolvedPrivate,
            esbPublicKey: !resolvedPublic,
            clientId: !process.env.CLIENT_ID,
            clientSecret: !process.env.CLIENT_SECRET,
            esbTokenUrl: !esbTokenUrl,
            esbEngineUrl: !esbEngineUrl
        };
        console.log('GovESB init nulls:', initNulls);
        return new GovEsbHelper({
            clientPrivateKey: resolvedPrivate,
            esbPublicKey: resolvedPublic,
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            esbTokenUrl,
            esbEngineUrl
        });
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privateDerB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
    const publicDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    RESOLVED_KEYS.esbPublic = RESOLVED_KEYS.esbPublic || publicDerB64;
    return new GovEsbHelper({
        clientPrivateKey: privateDerB64,
        esbPublicKey: publicDerB64
    });
}

const helper = initializeHelper();

// Utility: Safe string body
function asStringBody(body) {
    if (typeof body === 'string') return body;
    return JSON.stringify(body);
}

function tryParseJson(maybeJson) {
    if (typeof maybeJson !== 'string') return maybeJson;
    try {
        return JSON.parse(maybeJson);
    } catch (_e) {
        return undefined;
    }
}

const CONFIG = {
    apiCode: process.env.GOVESB_API_CODE || 'H0RiaUnK',
    pushApiCode: process.env.GOVESB_PUSH_API_CODE || 'MOXEV',
    defaultRecipientPublicKey: process.env.DEFAULT_RECIPIENT_PUBLIC_KEY || undefined
};


// POST /esb-test/php-producer
app.post('/esb-test/php-producer', async (req, res) => {
    try {
        const requestBody = asStringBody(req.body);
        const apiCode = String(req.query.code || req.headers['x-api-code'] || CONFIG.apiCode);
        const result = await helper.requestData(apiCode, requestBody, 'json');
        return res.type('application/json').send(result);
    } catch (err) {
        console.error(err);
        return res.status(500).send(String(err.message || err));
    }
});

// POST /esb-test/esb-dummy-route
app.post('/esb-test/esb-dummy-route', async (req, res) => {
    try {
        const targetUrl = 'http://0.0.0.0:7777/esb/dummy-route';
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: asStringBody(req.body)
        });
        const text = await response.text();
        return res.type('application/json').send(text);
    } catch (err) {
        console.error(err);
        return res.status(500).send(String(err.message || err));
    }
});

// Local echo route to support the dummy proxy test
app.post('/esb/dummy-route', (req, res) => {
    return res.json({ success: true, echoed: req.body });
});

// POST /esb-test/producer-sync-test
app.post('/esb-test/producer-sync-test', async (req, res) => {
    try {
        const requestBody = asStringBody(req.body);
        const esbData = helper.verifyThenReturnData(requestBody, 'json');
        // If signature invalid or absent, allow raw-payload mode
        if (!esbData) {
            const raw = req.body;
            const responseCandidate = (raw && (raw.responseBody ?? raw.reply)) ?? raw;
            if (typeof responseCandidate === 'undefined' || responseCandidate === null) {
                const failure = helper.failureResponse(null, 'Missing payload', 'json');
                return res.type('application/json').send(failure);
            }
            const responsePlaintext = typeof responseCandidate === 'string'
                ? responseCandidate
                : JSON.stringify(responseCandidate);
            const recipientPublicKey =
                req.headers['x-recipient-public-key']
                || process.env.DEFAULT_RECIPIENT_PUBLIC_KEY
                || RESOLVED_KEYS.esbPublic;
            if (!recipientPublicKey) {
                const failure = helper.failureResponse(null, 'Missing recipient public key', 'json');
                return res.type('application/json').send(failure);
            }
            const encryptedResponse = helper.encrypt(responsePlaintext, String(recipientPublicKey));
            const success = await helper.successResponse(encryptedResponse, 'json');
            return res.type('application/json').send(success);
        }

        const parsed = tryParseJson(esbData);
        const esbBodyNode = parsed.esbBody;
        if (!esbBodyNode) {
            // Raw-mode fallback if esbBody missing
            const raw = req.body;
            const responseCandidate = (raw && (raw.responseBody ?? raw.reply)) ?? raw;
            if (typeof responseCandidate === 'undefined' || responseCandidate === null) {
                const failure = helper.failureResponse(null, 'Missing esbBody/payload', 'json');
                return res.type('application/json').send(failure);
            }
            const responsePlaintext = typeof responseCandidate === 'string'
                ? responseCandidate
                : JSON.stringify(responseCandidate);
            const recipientPublicKey =
                req.headers['x-recipient-public-key']
                || process.env.DEFAULT_RECIPIENT_PUBLIC_KEY
                || RESOLVED_KEYS.esbPublic;
            if (!recipientPublicKey) {
                const failure = helper.failureResponse(null, 'Missing recipient public key', 'json');
                return res.type('application/json').send(failure);
            }
            const encryptedResponse = helper.encrypt(responsePlaintext, String(recipientPublicKey));
            const success = await helper.successResponse(encryptedResponse, 'json');
            return res.type('application/json').send(success);
        }

        const esbBodyString = typeof esbBodyNode === 'string' ? esbBodyNode : JSON.stringify(esbBodyNode);
        const decrypted = helper.decrypt(esbBodyString);
        const verified = parsed;
        let responseBodyObj =
            (verified && (verified.responseBody ?? verified.reply ?? null));
        let responsePlaintext;
        if (typeof responseBodyObj !== 'undefined' && responseBodyObj !== null) {
            responsePlaintext = typeof responseBodyObj === 'string'
                ? responseBodyObj
                : JSON.stringify(responseBodyObj);
        } else {
            responsePlaintext = decrypted;
        }

        let recipientPublicKey;
        if (typeof esbBodyNode === 'object' && esbBodyNode !== null && esbBodyNode.encryptionKey) {
            recipientPublicKey = esbBodyNode.encryptionKey;
        } else if (verified && verified.recipientPublicKey) {
            recipientPublicKey = String(verified.recipientPublicKey);
        } else if (req.headers['x-recipient-public-key']) {
            recipientPublicKey = String(req.headers['x-recipient-public-key']);
        } else if (CONFIG.defaultRecipientPublicKey) {
            recipientPublicKey = CONFIG.defaultRecipientPublicKey;
        } else if (RESOLVED_KEYS.esbPublic) {
            recipientPublicKey = RESOLVED_KEYS.esbPublic;
        }
        if (!recipientPublicKey) {
            const failure = helper.failureResponse(null, 'Missing recipient public key', 'json');
            return res.type('application/json').send(failure);
        }

        const encryptedResponse = helper.encrypt(responsePlaintext, recipientPublicKey);
        const success = await helper.successResponse(encryptedResponse, 'json');
        return res.type('application/json').send(success);
    } catch (err) {
        console.error(err);
        return res.status(500).send(String(err.message || err));
    }
});

// POST /esb-test/consumer-sync-test
app.post('/esb-test/consumer-sync-test', async (req, res) => {
    try {
        const requestBody = asStringBody(req.body);
        const encryptedEsbBody = helper.encrypt(requestBody, String("MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEs/Z4JNkbDChNm9KW4wwHquwoByLBc0iFZVTaYixH7nvmCxcFLQUnP0R4B0If8vYovvay6aSlxero2mA5au4N0Q=="));
        const success = await helper.requestData("MOXEV", encryptedEsbBody, 'json');
        return res.type('application/json').send(success);
    } catch (err) {
        console.error(err);
        return res.status(500).send(String(err.message || err));
    }
});


app.post('/esb-test/push-test', async (req, res) => {
    try {
        if (typeof helper.pushData !== 'function') {
            return res.status(501).json({ success: false, message: 'pushData not available in this helper version' });
        }
        const requestBody = asStringBody(req.body);
        const pullCode = String(req.query.code || req.headers['x-api-code'] || CONFIG.pushApiCode);
        console.log('push-test using pullCode:', pullCode);
        const result = await helper.pushData(pullCode, requestBody, 'json');
        return res.type('application/json').send(result);
    } catch (err) {
        console.error(err);
        return res.status(500).send(String(err.message || err));
    }
});

// POST /esb-test/push-test-receive
// - verifyThenReturnData
// - return successResponse({"success": true, "message": "Received"})
app.post('/esb-test/push-test-receive', async (req, res) => {
    try {
        const requestBody = asStringBody(req.body);
        const esbData = helper.verifyThenReturnData(requestBody, 'json');
        if (!esbData) {
            const failure = helper.failureResponse(null, 'Signature verification failed', 'json');
            return res.type('application/json').send(failure);
        }
        const responseNode = { success: true, message: 'Received' };
        const success = await helper.successResponse(JSON.stringify(responseNode), 'json');
        return res.type('application/json').send(success);
    } catch (err) {
        console.error(err);
        return res.status(500).send(String(err.message || err));
    }
});

// Health
app.get('/health', (_req, res) => {
    return res.json({ ok: true });
});

// Start server
const PORT = process.env.PORT ? Number(process.env.PORT) : 7777;
app.listen(PORT, () => {
    console.log(`GovESB Node server listening on http://0.0.0.0:${PORT}`);
});


