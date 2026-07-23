import { createServer } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const host = '127.0.0.1';
const port = Number(process.env.DEV_JWT_PORT ?? 4000);
const issuer = `http://${host}:${port}/`;
const audience = 'citadel-relay';
const subject = process.argv[2] ?? 'dev-user';
const algorithm = 'RS256';
const keyId = 'dev-key';

const { publicKey, privateKey } = await generateKeyPair(algorithm);
const publicJwk = {
  ...await exportJWK(publicKey),
  alg: algorithm,
  kid: keyId,
  use: 'sig'
};
const token = await new SignJWT({})
  .setProtectedHeader({ alg: algorithm, kid: keyId })
  .setIssuer(issuer)
  .setAudience(audience)
  .setSubject(subject)
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(privateKey);

createServer((request, response) => {
  if (request.url !== '/jwks.json') {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ keys: [publicJwk] }));
}).listen(port, host, () => {
  console.log(`Development JWKS: ${issuer}jwks.json`);
  console.log(`JWT for ${subject}:\n${token}`);
});
