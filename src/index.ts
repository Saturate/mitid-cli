// Public library exports

export type {
	Authenticators,
	MitIDClientOptions,
	StatusCallback,
} from "./client.js";
export { MitIDClient } from "./client.js";
export type {
	CodeAppAuthenticator,
	MitIDIdentity,
	ResolvedIdentity,
} from "./identity.js";
export {
	registerCodeApp,
	resolve,
	searchIdentity,
	simulatorUrl,
} from "./identity.js";
export type { LoginResult, LoginStatusCallback } from "./login.js";
export { login } from "./login.js";
export type { CookieJar, Provider, ProviderSession } from "./providers.js";
export { detectProvider, getProvider, listProviders } from "./providers.js";
export type { SimulatorStatusCallback } from "./simulator.js";
export { approve, watch } from "./simulator.js";
export { CustomSRP, createFlowValueProof } from "./srp.js";
export type { SavedIdentity } from "./storage.js";
export {
	addOrUpdate,
	exportUsers,
	findByAlias,
	importUsers,
	loadUsers,
	removeByAlias,
	saveUsers,
} from "./storage.js";
