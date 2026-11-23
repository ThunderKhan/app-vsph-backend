/** One-use invitation state machine. PostgreSQL owns all transitions and eligibility checks. */
export interface InvitationStore {
  inspect(id:string,tokenHash:string,actorId:string|null):Promise<{newIdentity:boolean}>;
  reserve(id:string,tokenHash:string,actorId:string|null,acceptanceId:string):Promise<{
    newIdentity:boolean;userId:string
  }>;
  setNewIdentityPassword(userId:string,password:string):Promise<void>;
  finish(id:string,tokenHash:string,actorId:string|null,acceptanceId:string):Promise<void>;
  markFailed(id:string,tokenHash:string,actorId:string|null,acceptanceId:string):Promise<void>;
}
