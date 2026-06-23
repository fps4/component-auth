import { readFileSync } from 'fs';
import process from 'process';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
const requireFromService = createRequire(new URL('../service/package.json', import.meta.url));
import type * as mongooseType from 'mongoose';
const mongoose = requireFromService('mongoose') as typeof mongooseType;
import { getTenantModel } from '../service/src/models/tenant.js';
import { hashSecret } from '../service/src/utils/hash.js';

interface Options {
  mongoUri: string;
  dbName: string;
  tenantFile: string;
  clientName?: string;
  clientScopes?: string[];
  outputSecret?: boolean;
}

function parseArgs(): Options {
  const args = new Map<string, string>();
  for (const entry of process.argv.slice(2)) {
    const [key, value] = entry.split('=');
    if (key && value) args.set(key.replace(/^--/, ''), value);
  }

  const mongoUri = args.get('mongoUri') ?? process.env.MONGO_URI ?? 'mongodb://localhost:27017';
  const dbName = args.get('dbName') ?? process.env.MONGO_DB_NAME ?? 'identity-service';
  const tenantFile = args.get('tenantFile') ?? 'tests/new-tenant.json';
  const clientName = args.get('clientName') ?? undefined;
  const clientScopes = args.get('clientScopes')?.split(',').map((value) => value.trim()).filter(Boolean);
  const outputSecret = args.get('outputSecret') === 'true';

  return { mongoUri, dbName, tenantFile, clientName, clientScopes, outputSecret };
}

async function main() {
  const options = parseArgs();
  const raw = readFileSync(options.tenantFile, 'utf-8');
  const tenantPayload = JSON.parse(raw);

  const connection = await mongoose.createConnection(`${options.mongoUri}/${options.dbName}`).asPromise();
  const Tenant = getTenantModel(connection);
  const tenantDoc = await Tenant.create(tenantPayload);

  console.log(`Inserted tenant ${tenantDoc._id}`);

  if (options.clientName) {
    const clientId = randomUUID();
    const secret = randomUUID().replace(/-/g, '');
    const { getOAuthClientModel } = await import('../service/src/models/oauth-client.js');
    const OAuthClient = getOAuthClientModel(connection);
    await OAuthClient.create({
      _id: clientId,
      tenantId: tenantDoc._id,
      name: options.clientName,
      secretHash: hashSecret(secret),
      grantTypes: ['client_credentials'],
      scopes: options.clientScopes && options.clientScopes.length ? options.clientScopes : tenantPayload.oauth?.allowedScopes ?? [],
      isConfidential: true
    });
    console.log(`Provisioned client ${clientId}`);
    if (options.outputSecret) {
      console.log(`Client secret: ${secret}`);
    }
  }

  await connection.close();
}

main().catch((error) => {
  console.error('Failed to load tenant', error);
  process.exit(1);
});
