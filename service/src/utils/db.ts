import mongoose, { Connection } from 'mongoose';
import { CONFIG } from '../config.js';
import logger from './logger.js';

let masterConnection: Connection | null = null;

const mongooseOptions: mongoose.ConnectOptions = {
  maxPoolSize: 10,
  autoIndex: false
};

const waitForOpen = (conn: Connection) =>
  new Promise<Connection>((resolve, reject) => {
    if (conn.readyState === 1) return resolve(conn);
    conn.once('open', () => resolve(conn));
    conn.once('error', (err) => reject(err));
  });

export async function getMasterConnection(): Promise<Connection> {
  if (masterConnection && masterConnection.readyState === 1) {
    return masterConnection;
  }

  const uri = `${CONFIG.mongo.uri}/${CONFIG.mongo.dbName}`;
  logger.info({ uri }, 'connecting to MongoDB');

  try {
    const connection = mongoose.createConnection(uri, mongooseOptions);
    await waitForOpen(connection);
    masterConnection = connection;
    logger.info({ db: connection.name }, 'MongoDB connected');
    return connection;
  } catch (error) {
    logger.error({ err: error }, 'failed to connect to MongoDB');
    throw error;
  }
}

/**
 * The master connection's mongoose readyState (0=disconnected, 1=connected, 2=connecting,
 * 3=disconnecting), or 0 if we have not connected yet. Used by the maestro telemetry snapshot to
 * derive a liveness status without reaching into the private connection handle.
 */
export function masterConnectionReadyState(): number {
  return masterConnection?.readyState ?? 0;
}

export async function disconnect(): Promise<void> {
  if (masterConnection && masterConnection.readyState !== 0) {
    await masterConnection.close();
    masterConnection = null;
  }
}
