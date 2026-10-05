import crypto from 'node:crypto';
import tls from 'node:tls';
import { httpError } from './util.js';

// Amazon requires a self-hosted skill endpoint to check that every request really comes from Alexa:
// https://developer.amazon.com/docs/custom-skills/host-a-custom-skill-as-a-web-service.html
// 1. the signing certificate is downloaded from s3.amazonaws.com/echo.api/ and chains to a trusted CA,
// 2. the certificate is valid now and issued to echo-api.amazon.com,
// 3. the body is signed with it (Signature-256 header, SHA-256 with RSA),
// 4. the request timestamp is at most 150 seconds old.

const MAX_SKEW_MS = 150_000;
const CERT_CACHE_MS = 24 * 3600e3;
const certCache = new Map(); // url -> { pems, at }

export function validCertUrl(raw) {
  let u;
  try {
    u = new URL(raw); // resolves "/echo.api/../" tricks and lowercases the host
  } catch {
    return false;
  }
  return u.protocol === 'https:'
    && u.hostname === 's3.amazonaws.com'
    && u.pathname.startsWith('/echo.api/')
    && (u.port === '' || u.port === '443');
}

const splitPem = (pem) => String(pem).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];

let systemRoots = null;
const trustedRoots = () => (systemRoots ??= tls.rootCertificates.map((p) => new crypto.X509Certificate(p)));

function checkDates(cert, now, label) {
  if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now) throw httpError(400, `Certificato Alexa ${label} scaduto o non ancora valido`);
}

const spki = (cert) => cert.publicKey.export({ type: 'spki', format: 'der' });

/** A chain certificate is trusted when it *is* a root (same name and key, even cross-signed) or a root signed it. */
function trustedBy(cert, roots) {
  return roots.some((root) => (root.subject === cert.subject && spki(root).equals(spki(cert)))
    || (cert.checkIssued(root) && cert.verify(root.publicKey)));
}

/** Validates the PEM chain and returns the signing (leaf) certificate. */
export function verifyChain(pems, { now = Date.now(), roots = trustedRoots() } = {}) {
  const certs = pems.map((p) => new crypto.X509Certificate(p));
  if (!certs.length) throw httpError(400, 'Catena di certificati Alexa vuota');
  const leaf = certs[0];
  checkDates(leaf, now, 'di firma');
  const names = (leaf.subjectAltName || '').split(',').map((s) => s.trim().toLowerCase());
  if (!names.includes('dns:echo-api.amazon.com')) throw httpError(400, 'Il certificato non appartiene a echo-api.amazon.com');
  // Walk up until a trusted root: Amazon also sends cross-signatures above "Amazon Root CA 1" that we don't need.
  for (let i = 0; i < certs.length; i += 1) {
    if (trustedBy(certs[i], roots)) return leaf;
    const issuer = certs[i + 1];
    if (!issuer) break;
    checkDates(issuer, now, 'intermedio');
    if (!issuer.ca || !certs[i].checkIssued(issuer) || !certs[i].verify(issuer.publicKey)) {
      throw httpError(400, 'Catena di certificati Alexa non valida');
    }
  }
  throw httpError(400, 'Certificato Alexa non emesso da una CA attendibile');
}

async function fetchChain(url) {
  const hit = certCache.get(url);
  if (hit && Date.now() - hit.at < CERT_CACHE_MS) return hit.pems;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw httpError(400, `Certificato Alexa non scaricabile (${res.status})`);
  const pems = splitPem(await res.text());
  certCache.set(url, { pems, at: Date.now() });
  return pems;
}

/**
 * Throws a 400 error when the request is not a genuine, fresh Alexa request.
 * `rawBody` must be the exact bytes received: the signature covers them, not the parsed JSON.
 */
export async function verifyAlexaRequest(headers, rawBody, body, { now = Date.now(), roots, getChain = fetchChain } = {}) {
  const certUrl = headers['signaturecertchainurl'];
  const signature = headers['signature-256'];
  if (!certUrl || !signature) throw httpError(400, 'Richiesta Alexa senza firma');
  if (!validCertUrl(certUrl)) throw httpError(400, 'URL del certificato Alexa non valido');

  const ts = Date.parse(body?.request?.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) throw httpError(400, 'Richiesta Alexa scaduta');

  const leaf = verifyChain(await getChain(certUrl), { now, ...(roots ? { roots } : {}) });
  const ok = crypto.verify('sha256', Buffer.from(rawBody, 'utf8'), leaf.publicKey, Buffer.from(String(signature), 'base64'));
  if (!ok) throw httpError(400, 'Firma della richiesta Alexa non valida');
}
