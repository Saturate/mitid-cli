# mitid

CLI and Node.js library for authenticating with Denmark's MitID test environment; without a browser.

## Why?

MitID's browser widget carries the same anti-automation protections in the pre-production test environment (pp.mitid.dk) as in production. It renders inside a cross-origin iframe, includes `debugger` traps, and detects automated browsers. This makes sense in production, but makes automated testing unnecessarily difficult. Standard tools like Puppeteer, Playwright, and Selenium can't interact with the widget, and Chrome DevTools Protocol (CDP) connections cause it to freeze.

This tool sidesteps the widget entirely by implementing the MitID authentication protocol directly over HTTP; the same custom SRP-6a key exchange, the same API endpoints, just without the iframe. Combined with the MitID test simulator API for auto-approving login requests, it enables fully automated MitID authentication for your test workflows.

## Install

```bash
npm install -g @saturate/mitid
```

Or use directly with npx:

```bash
npx @saturate/mitid --help
```

## Quick start

```bash
# Look up a test identity
mitid info <username>

# Save it for quick access
mitid save <username> myuser

# See all saved identities
mitid list
```

## Usage

### Manual browser testing

You log in through your browser, the CLI handles the MitID approval step automatically:

```bash
# Auto-approve the next login attempt
mitid approve myuser

# Or keep it running to approve every login attempt
mitid approve myuser --watch
```

When MitID asks you to approve in the app, the CLI does it automatically via the simulator.

### Fully automated login

No browser needed. Gets session cookies you can use with curl, fetch, Playwright, etc:

```bash
# Terminal 1: start the login
mitid login myuser https://your-service.example.com/login/mitid

# Terminal 2: auto-approve when prompted
mitid approve myuser
```

The login command outputs session cookies and copies them to clipboard.

### AI agent / browser automation

For AI agents (Claude, Cursor, etc.) controlling a browser via Chrome DevTools MCP, Playwright, or similar; where the MitID widget refuses to render:

1. Run `mitid login <user> <service-login-url>` to get session cookies
2. Run `mitid approve <user>` in parallel to auto-approve
3. Inject the cookies into the automated browser
4. Navigate to the service; you're logged in

```javascript
// Example: inject cookies into an automated browser
const cookies = { "SessionCookie": "<value>", "AuthToken": "<value>" };
for (const [name, value] of Object.entries(cookies)) {
  document.cookie = `${name}=${value}; path=/`;
}
location.reload();
```

### Full guide

```bash
mitid guide
```

Prints detailed workflow instructions for all use cases including library usage.

## Commands

| Command | Description |
|---------|-------------|
| `mitid info <query>` | Show identity details (username, UUID, CPR, authenticators) |
| `mitid login <query> <url>` | Complete a full MitID login and output session cookies |
| `mitid approve <query>` | Poll and auto-approve a pending MitID login via the simulator. Use `--watch` to keep approving |
| `mitid save <query> [alias]` | Save an identity for quick access |
| `mitid list` | Show all saved identities |
| `mitid remove <alias>` | Remove a saved identity |
| `mitid open <query>` | Open the simulator in the default browser |
| `mitid copy <query>` | Copy the simulator URL to clipboard |
| `mitid json <query>` | Output full identity data as JSON |
| `mitid guide` | Show detailed usage guide |

Query can be a MitID username, UUID, CPR number, or a saved alias.

## Library usage

```typescript
import { MitIDClient, login, approve, resolve } from '@saturate/mitid';

// Look up a test identity
const { identity, codeApp } = await resolve('TestUser123');
console.log(identity.identityName, identity.cprNumber);

// Full login flow (returns session cookies)
const result = await login(
  'TestUser123',
  'https://your-service.example.com/login/mitid',
  console.log // status callback
);
console.log(result.cookies);

// Auto-approve a pending login
await approve(identity.identityId, codeApp.authenticatorId);

// Or use the MitID client directly
const client = new MitIDClient('https://pp.mitid.dk');
await client.init(clientHash, authenticationSessionId);
await client.identifyAndGetAuthenticators('TestUser123');
await client.authenticateWithApp();
const authorizationCode = await client.finalize();
```

## Environment

By default, the CLI targets MitID's pre-production environment (`pp.mitid.dk`). To use production:

```bash
mitid info <query> --env prod
```

## How it works

The tool replaces two things that normally require a browser and a phone:

1. **The MitID browser widget**; replaced by a direct HTTP implementation of the [MitID authentication protocol](https://github.com/Hundter/MitID-BrowserClient) (custom SRP-6a with 4096-bit parameters)
2. **The MitID app approval**; replaced by the [MitID test simulator API](https://pp.mitid.dk/test-tool/frontend/) which auto-approves with the test PIN

```
Service login URL
  → OAuth redirect chain → Criipto/NemLog-in broker → MitID session
  → Identify user → APP auth (push to simulator) → Poll for approval
  → SRP-6a key exchange → Finalize → Authorization code
  → Service callback → Session cookies
```

## Supported providers

The login flow auto-detects your MitID broker from the OAuth redirect chain:

| Provider | Detection | Used by |
|----------|-----------|---------|
| **Criipto** | `*.idura.broker` or `criipto.*` URLs | Services using Criipto Verify |
| **NemLog-in** | `nemlog-in.mitid.dk` | Danish public services (borger.dk, skat.dk, e-boks, etc.) |
| **Direct MitID** | `mitid.dk/administration` | mitid.dk self-service portal |

```bash
mitid providers   # list all supported providers
```

### Adding a provider

If your service uses a broker not listed above, you can add a custom provider. A provider needs two things:

1. **`detect`** - identify the broker from the URL/HTML after OAuth redirects
2. **`bootstrap`** - extract the MitID `aux` (session ID + checksum) and return an exchange callback

```typescript
import { login } from '@saturate/mitid';
import type { Provider, CookieJar } from '@saturate/mitid';

const myProvider: Provider = {
  name: 'MyBroker',

  detect: (url, body) => url.includes('my-broker.example.com'),

  async bootstrap(url, body, cookies) {
    // Extract aux from your broker's page (HTML scraping, JSON endpoint, etc.)
    const aux = /* ... */;

    return {
      clientHash: Buffer.from(aux.coreClient.checksum, 'base64').toString('hex'),
      authenticationSessionId: aux.parameters.authenticationSessionId,
      apiBaseUrl: 'https://pp.mitid.dk', // or extract from aux.parameters.apiUrl
      cookies,
      exchange: async (authCode: string, cookies: CookieJar) => {
        // Return the URL to redirect to with the auth code
        return { redirectUrl: `https://my-broker.example.com/callback?code=${authCode}` };
      },
    };
  },
};

// Use it
const result = await login('username', 'https://my-service.com/login', console.log, myProvider);
```

PRs adding new providers to `src/providers.ts` are welcome.

## Requirements

- Node.js 18+

## Acknowledgments

The MitID protocol implementation is ported from [Hundter/MitID-BrowserClient](https://github.com/Hundter/MitID-BrowserClient) (MIT), a Python implementation that reverse-engineered the MitID browser client. This project is a TypeScript/Node.js port with added simulator auto-approval and CLI tooling.

## License

MIT
