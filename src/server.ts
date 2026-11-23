import 'dotenv/config';
import { buildApp } from './app.js';
import { parseEnv } from './config.js';

const env = parseEnv(process.env);
const app = buildApp(env);
try {
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (error) {
  app.log.error({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'server startup failed');
  process.exitCode = 1;
  await app.close();
}
