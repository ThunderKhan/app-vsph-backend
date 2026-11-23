import type {FastifyInstance} from 'fastify';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {PortalSessionError,resolvePortalSession} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {WorkspaceCountStore} from './store.js';

export function installWorkspaces(app:FastifyInstance,auth:AuthStore,store:WorkspaceCountStore):void{
 app.get('/api/workspaces',async req=>{
  if(Object.keys(req.query as Record<string,unknown>).length)
   throw new HttpError(400,'INVALID_REQUEST','Workspace filters are not supported.');
  const raw=sessionCookies(req)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{
   const user=await resolvePortalSession(raw,{
    findByTokenHash:hash=>auth.portalSession(hash),
   });
   return store.count(user.user.id,user.user.platform_role==='super_admin');
  }catch(error){
   if(error instanceof PortalSessionError)
    throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 });
}
