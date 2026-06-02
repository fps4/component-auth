/**
 * Admin CLI for local-credential users (RQ-0002). The operator-side counterpart to self-service
 * registration: create users, reset passwords, and lock/unlock/disable accounts — the password-reset
 * path while there is no email channel. Run with tsx against the service's Mongo.
 *
 *   tsx scripts/manage-users.ts create       --tenant=<id> --email=<e> --password=<p>
 *   tsx scripts/manage-users.ts set-password  --tenant=<id> --email=<e> --password=<p>
 *   tsx scripts/manage-users.ts set-roles     --tenant=<id> --email=<e> --roles=a,b   (RQ-0005; "" clears)
 *   tsx scripts/manage-users.ts lock|unlock|disable|enable|delete --tenant=<id> --email=<e>
 *
 * MONGO_URI / MONGO_DB_NAME come from the environment (or .env), same as the service.
 */
import process from 'process';
import { getMasterConnection, disconnect } from '../src/utils/db.js';
import { makeModels } from '../src/models/index.js';
import { hashSecret } from '../src/utils/hash.js';
import { assertPasswordPolicy, normalizeEmail } from '../src/services/users.js';

function parseArgs() {
  const [command, ...rest] = process.argv.slice(2);
  const args = new Map<string, string>();
  for (const entry of rest) {
    const [key, value] = entry.split('=');
    if (key?.startsWith('--') && value !== undefined) args.set(key.replace(/^--/, ''), value);
  }
  return { command, args };
}

async function main() {
  const { command, args } = parseArgs();
  const tenantId = args.get('tenant');
  const email = args.get('email') ? normalizeEmail(args.get('email')!) : undefined;
  if (!command || !tenantId || !email) {
    console.error('Usage: manage-users <create|set-password|set-roles|lock|unlock|disable|enable|delete> --tenant=<id> --email=<e> [--password=<p>] [--roles=a,b]');
    process.exitCode = 2;
    return;
  }

  const connection = await getMasterConnection();
  const { User } = makeModels(connection);
  const now = new Date();

  switch (command) {
    case 'create': {
      const password = args.get('password');
      if (!password) throw new Error('--password is required for create');
      assertPasswordPolicy(password);
      const existing = await User.findOne({ tenantId, email }).lean().exec();
      if (existing) throw new Error(`User already exists: ${email}`);
      const doc = await User.create({ tenantId, email, passwordHash: hashSecret(password), status: 'active', passwordUpdatedAt: now });
      console.log(`created user ${doc._id} (${email}) — this id is the token sub`);
      break;
    }
    case 'set-password': {
      const password = args.get('password');
      if (!password) throw new Error('--password is required for set-password');
      assertPasswordPolicy(password);
      const result = await User.updateOne(
        { tenantId, email },
        { $set: { passwordHash: hashSecret(password), passwordUpdatedAt: now, failedAttempts: 0, lockedUntil: null, updatedAt: now } }
      ).exec();
      report(result.matchedCount, email, 'password reset');
      break;
    }
    case 'set-roles': {
      const raw = args.get('roles') ?? '';
      const roles = raw.split(',').map((r) => r.trim()).filter(Boolean);
      const result = await User.updateOne(
        { tenantId, email },
        { $set: { roles, updatedAt: now } }
      ).exec();
      report(result.matchedCount, email, `roles set to [${roles.join(', ')}]`);
      break;
    }
    case 'lock':
    case 'unlock':
    case 'disable':
    case 'enable':
    case 'delete': {
      const set =
        command === 'lock' ? { status: 'locked', lockedUntil: null }
        : command === 'unlock' ? { status: 'active', failedAttempts: 0, lockedUntil: null }
        : command === 'disable' ? { status: 'disabled' }
        : command === 'enable' ? { status: 'active', failedAttempts: 0, lockedUntil: null }
        : null;
      if (command === 'delete') {
        const result = await User.deleteOne({ tenantId, email }).exec();
        report(result.deletedCount, email, 'deleted');
      } else {
        const result = await User.updateOne({ tenantId, email }, { $set: { ...set, updatedAt: now } }).exec();
        report(result.matchedCount, email, command);
      }
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function report(count: number, email: string, action: string) {
  if (!count) {
    console.error(`No user matched ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${action}: ${email}`);
  }
}

main()
  .catch((err) => { console.error(err.message ?? err); process.exitCode = 1; })
  .finally(() => disconnect());
