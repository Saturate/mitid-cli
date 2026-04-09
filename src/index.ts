// Public library exports
export { CustomSRP, createFlowValueProof } from "./srp.js";
export { MitIDClient } from "./client.js";
export type { MitIDClientOptions, StatusCallback, Authenticators } from "./client.js";
export { login } from "./login.js";
export type { LoginResult, LoginStatusCallback } from "./login.js";
export { approve } from "./simulator.js";
export type { SimulatorStatusCallback } from "./simulator.js";
export {
  searchIdentity,
  resolve,
  simulatorUrl,
} from "./identity.js";
export type {
  MitIDIdentity,
  CodeAppAuthenticator,
  ResolvedIdentity,
} from "./identity.js";
export {
  loadUsers,
  saveUsers,
  findByAlias,
  addOrUpdate,
  removeByAlias,
} from "./storage.js";
export type { SavedIdentity } from "./storage.js";
