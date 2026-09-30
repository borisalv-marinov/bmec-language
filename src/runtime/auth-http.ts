import type {HttpRequest} from '../http/runtime.js';
import type {AuthService,Session,SessionRepository,SessionStore} from './auth.js';
import type {Principal} from './authorization.js';

export function sessionFromRequest(request:HttpRequest,store:SessionStore,now=Date.now()):Session|undefined{
 const id=sessionIdFromRequest(request);return id?store.get(id,now):undefined;
}
function sessionIdFromRequest(request:HttpRequest):string|undefined{
 const headers=request.headers??{},key=Object.keys(headers).find(x=>x.toLowerCase()==='authorization'),value=key?headers[key]:undefined;
 const bearer=value?(/^Bearer\s+([^\s]+)$/i.exec(value)?.[1]):undefined;if(bearer)return bearer;
 const cookieKey=Object.keys(headers).find(x=>x.toLowerCase()==='cookie'),cookie=cookieKey?headers[cookieKey]:undefined;const session=cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-pipe_session=')||x.startsWith('pipe_session='));const prefix=session?.startsWith('__Host-pipe_session=')?'__Host-pipe_session=':'pipe_session=';try{return session?decodeURIComponent(session.slice(prefix.length)):undefined}catch{return undefined}
}
export async function resolveSessionFromRequest(request:HttpRequest,store:SessionRepository,now=Date.now()):Promise<Session|undefined>{const id=sessionIdFromRequest(request);return id?await store.get(id,now):undefined}
export function requireSession(request:HttpRequest,store:SessionStore,now=Date.now()):Session{const session=sessionFromRequest(request,store,now);if(!session)throw new Error('PIPE-AUTH-002: authenticated session required');return session;}
export async function principalFromRequest(request:HttpRequest,auth:AuthService,now=Date.now()):Promise<Principal|undefined>{const session=await resolveSessionFromRequest(request,auth.sessions,now);if(!session)return undefined;const user=await auth.userForSession(session,now);return user?{id:user.id,attributes:user.attributes}:undefined;}
export function sessionCookie(session:Session,secure=true):string{return `${secure?'__Host-pipe_session':'pipe_session'}=${encodeURIComponent(session.id)}; Max-Age=${Math.max(0,Math.floor((session.expiresAt-session.createdAt)/1000))}; HttpOnly; SameSite=Lax; Path=/${secure?'; Secure':''}`}
export function expiredSessionCookie(secure=true):string{return `${secure?'__Host-pipe_session':'pipe_session'}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/${secure?'; Secure':''}`}
