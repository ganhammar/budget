import { defineConfig } from '@playwright/test';

/**
 * Runs against the dev server and a local API, so the whole path is exercised:
 * the browser, the Vite proxy, the minimal API, and DynamoDB Local.
 *
 * The table is separate from the one `npm run dev` uses. A test that empties a
 * household should never be able to empty the one being worked in.
 */
const API_PORT = 5081;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    // Vite resolves `localhost` to ::1 and binds only there, so an address literal
    // is refused. The cookie domain in the tests has to match this host.
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command:
        'dotnet run --no-launch-profile --project ../api/src/Budget.Api -c Release',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ASPNETCORE_URLS: `http://localhost:${API_PORT}`,
        DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8042',
        TABLE_NAME: process.env.TABLE_NAME ?? 'budget-e2e',
        GOOGLE_CLIENT_ID: 'e2e.apps.googleusercontent.com',
        EMAIL_ENABLED: 'false',
        // Nothing here talks to AWS, but the API builds its SES client at startup
        // and a client with no region refuses to be constructed. The .NET SDK reads
        // AWS_REGION; AWS_DEFAULT_REGION is the CLI's spelling and is not enough.
        AWS_ACCESS_KEY_ID: 'local',
        AWS_SECRET_ACCESS_KEY: 'local',
        AWS_REGION: 'eu-north-1',
        AWS_DEFAULT_REGION: 'eu-north-1',
      },
    },
    {
      command: `npm run dev -- --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_API_PROXY: `http://localhost:${API_PORT}`,
        // Only has to be present: the landing page offers the sign-in once a client
        // is configured, and the test stops at the offer. Google itself is not
        // reachable from a test, and nothing here pretends otherwise.
        VITE_GOOGLE_CLIENT_ID: 'e2e.apps.googleusercontent.com',
      },
    },
  ],
});
