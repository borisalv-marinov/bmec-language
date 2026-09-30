import type {HttpPolicy} from './runtime.js';
import type {SessionRepository} from '../runtime/auth.js';
import type {AuthService} from '../runtime/auth.js';
import {principalFromRequest,resolveSessionFromRequest} from '../runtime/auth-http.js';
import type {Principal} from '../runtime/authorization.js';

export type Clock = () => number;
export type PolicyAttributeValue = string|number|boolean;

/** Server-side route policy backed by the opaque session store. The browser
 * can present credentials, but it cannot grant itself authorization. */
export function authenticatedSession(store: SessionRepository, clock: Clock = () => Date.now()): HttpPolicy {
  return async request => (await resolveSessionFromRequest(request, store, clock())) !== undefined;
}

/** Restrict a route to one server-resolved user identity. */
export function sessionUser(store: SessionRepository, userId: string, clock: Clock = () => Date.now()): HttpPolicy {
  if (!userId) throw new Error('PIPE-AUTHZ-002: policy user ID is required');
  return async request => (await resolveSessionFromRequest(request, store, clock()))?.userId === userId;
}

/** Evaluate authorization against a principal resolved from the server-side
 * session. Request data and browser claims are never treated as identity. */
export function principalPolicy(auth: AuthService, policy: (principal: Principal, request: Parameters<HttpPolicy>[0], params: Parameters<HttpPolicy>[1]) => boolean|Promise<boolean>, clock: Clock = () => Date.now()): HttpPolicy {
  return async (request, params) => {const principal=await principalFromRequest(request,auth,clock());return principal?await policy(principal,request,params):false;};
}

/** Restrict a route to a server-resolved principal attribute. */
export function principalAttributePolicy(auth: AuthService, name: string, value: PolicyAttributeValue, clock: Clock = () => Date.now()): HttpPolicy {
  if (!name) throw new Error('PIPE-AUTHZ-003: policy attribute name is required');
  return principalPolicy(auth, principal => principal.attributes[name] === value, clock);
}

/** Restrict a route to a server-resolved role attribute. */
export function rolePolicy(auth: AuthService, role: string, clock: Clock = () => Date.now()): HttpPolicy {
  if (!role) throw new Error('PIPE-AUTHZ-004: policy role is required');
  return principalAttributePolicy(auth, 'role', role, clock);
}
