import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {HttpError} from '../../errors.js';
import {sessionCookies} from '../auth/cookies.js';
import {PORTAL_COOKIE} from '../auth/session-tokens.js';
import {resolvePortalSession,PortalSessionError} from '../auth/portal-session.js';
import type {AuthStore} from '../auth/store.js';
import type {NotificationStore} from './store.js';

const prefs=z.strictObject({assignments:z.boolean(),delivery:z.boolean(),overdue:z.boolean()});
function invalid():never{throw new HttpError(400,'INVALID_NOTIFICATION_FIELDS',
 'Invalid notification/report request.');}
export function installNotificationRoutes(app:FastifyInstance,auth:AuthStore,
 store:NotificationStore):void {
 async function actor(req:FastifyRequest):Promise<string>{
  const raw=sessionCookies(req)[PORTAL_COOKIE];
  if(!raw)throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
  try{return (await resolvePortalSession(raw,{
   findByTokenHash:hash=>auth.portalSession(hash),
  })).user.id;}catch(error){
   if(error instanceof PortalSessionError)
     throw new HttpError(401,'SESSION_REQUIRED','Please sign in.');
   throw error;
  }
 }
 app.get('/api/notifications',async req=>{
  const who=await actor(req);
  // The frozen source dispatches SQL-backed pending notices before reading.
  // Never return a fabricated inbox if dispatch is unavailable.
  await store.command(who,'dispatch',{});
  return store.command(who,'inbox',{});
 });
 app.post('/api/notifications/retry',async req=>
   store.command(await actor(req),'retry',{}));
 app.get('/api/notifications/preferences',async req=>
   store.command(await actor(req),'preferences',{}));
 app.post('/api/notifications/preferences',async req=>{
  const parsed=prefs.safeParse(req.body);
  if(!parsed.success)return invalid();
  return store.command(await actor(req),'preferences.save',parsed.data);
 });
 app.post<{Params:{notificationId:string}}>('/api/notifications/:notificationId/read',async req=>{
  if(!/^[0-9]{1,16}$/.test(req.params.notificationId))return invalid();
  return store.command(await actor(req),'read',{notificationId:req.params.notificationId});
 });
}
