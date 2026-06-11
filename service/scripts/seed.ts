/**
 * Idempotent seed loader (RQ-0004). Reads a gitignored YAML config of tenants + OAuth clients +
 * local users and upserts them into Mongo. Operator-run (NOT an HTTP endpoint — ADR-0003); the only
 * secret it needs is the Mongo connection from the environment.
 *
 *   cd service
 *   npm run seed                       # reads ../config/seed.yaml
 *   npm run seed -- --file=/abs/path   # explicit file
 *
 * MONGO_URI / MONGO_DB_NAME come from the environment (.env), same as the service. Re-running is
 * safe: tenants and clients are upserted; existing users are left untouched (insert-if-absent), so a
 * re-run never resets a password — use `manage-users set-password` to change one.
 */
import process from 'process';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { getMasterConnection, disconnect } from '../src/utils/db.js';
import { makeModels } from '../src/models/index.js';
import { hashSecret } from '../src/utils/hash.js';
import { parseSeedConfig } from '../src/services/seed-config.js';
import { assertPasswordPolicy } from '../src/services/users.js';

function resolveFile(): string {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--file='));
  if (arg) return arg.slice('--file='.length);
  if (process.env.SEED_FILE) return process.env.SEED_FILE;
  return new URL('../../config/seed.yaml', import.meta.url).pathname; // repo-root/config/seed.yaml
}

async function main() {
  const file = resolveFile();
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    throw new Error(`Seed file not found: ${file} (copy config/seed.example.yaml to config/seed.yaml)`);
  }

  const config = parseSeedConfig(parseYaml(text), process.env);
  // Fail fast on weak passwords before touching the DB.
  for (const t of config.tenants) for (const u of t.users ?? []) assertPasswordPolicy(u.password);

  const connection = await getMasterConnection();
  const { Tenant, OAuthClient, User } = makeModels(connection);
  const now = new Date();
  let tenantsUpserted = 0, clientsUpserted = 0, usersCreated = 0, usersSkipped = 0;

  for (const t of config.tenants) {
    await Tenant.updateOne(
      { _id: t.id },
      { $set: {
          name: t.name, status: t.status, allowedOrigins: t.allowedOrigins,
          oauth: { enabled: t.oauth.enabled, allowedGrantTypes: t.oauth.allowedGrantTypes,
                   allowedScopes: t.oauth.allowedScopes, allowedRoles: t.oauth.allowedRoles,
                   idp: t.oauth.idp, limits: t.oauth.limits },
          updatedAt: now
      } },
      { upsert: true }
    ).exec();
    tenantsUpserted++;

    for (const c of t.clients ?? []) {
      const set: Record<string, unknown> = {
        tenantId: t.id, name: c.name, grantTypes: c.grantTypes,
        redirectUris: c.redirectUris, scopes: c.scopes, audience: c.audience,
        isConfidential: c.isConfidential, updatedAt: now
      };
      // A client-credentials machine principal (US-0086): the runtime subject + additive claims.
      if (c.subject !== undefined) set.subject = c.subject;
      if (c.claims !== undefined) set.claims = c.claims;
      if (c.secret) set.secretHash = hashSecret(c.secret);
      await OAuthClient.updateOne({ _id: c.id }, { $set: set }, { upsert: true }).exec();
      clientsUpserted++;
    }

    for (const u of t.users ?? []) {
      const existing = await User.findOne({ tenantId: t.id, email: u.email }).lean().exec();
      if (existing) { usersSkipped++; continue; } // never clobber an existing account on re-run
      await User.create({
        tenantId: t.id, email: u.email, passwordHash: hashSecret(u.password),
        status: u.status, roles: u.roles ?? [], passwordUpdatedAt: now
      });
      usersCreated++;
    }
  }

  console.log(`seed: ${tenantsUpserted} tenants, ${clientsUpserted} clients upserted; ${usersCreated} users created, ${usersSkipped} existing skipped`);
}

main()
  .catch((err) => { console.error(err.message ?? err); process.exitCode = 1; })
  .finally(() => disconnect());
