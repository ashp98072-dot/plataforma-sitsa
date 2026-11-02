// TEST DOUBLE ONLY: serial Map snapshots are NOT SQL, durable jobs, distributed leases or recovery.
import { AdaptationError, type AdaptationRepository, type AdaptationScope, type AdaptationJob, type AdaptationLink, type AdaptationTrace, type AdaptationTransaction } from '../tms-adaptation-contracts';
import { adaptationNamespace } from '../tms-adaptation';
export class AdaptationModel implements AdaptationRepository {
  jobs=new Map<string,AdaptationJob>();links=new Map<string,AdaptationLink>();traces:AdaptationTrace[]=[];
  failAt:'job'|'link'|'trace'|'commit'|null=null; failTransaction:number|null=null; calls=0;
  private tail:Promise<void>=Promise.resolve();
  key(scope:AdaptationScope,key:string){return JSON.stringify([adaptationNamespace(scope),key]);}
  async runAtomic<T>(scope:AdaptationScope,action:(tx:AdaptationTransaction)=>Promise<T>):Promise<{value:T;assurance:'SIMULATED'}>{
    const call=++this.calls;const previous=this.tail;let unlock!:()=>void;this.tail=new Promise<void>(r=>{unlock=r;});await previous;
    const saved=structuredClone({jobs:this.jobs,links:this.links,traces:this.traces});
    const fault=(point:typeof this.failAt)=>{if(this.failAt===point&&(this.failTransaction===null||this.failTransaction===call)){this.failAt=null;throw new Error('SQL SECRET TEST FAULT');}};
    const cas=(previous:number|null,current:{version:number}|undefined)=>{if((current?.version??null)!==previous)throw new AdaptationError('CONFLICT');};
    try{
      const result=await action({
        job:async key=>structuredClone(this.jobs.get(this.key(scope,key))??null),
        saveJob:async(job,version)=>{fault('job');const key=this.key(scope,job.key);cas(version,this.jobs.get(key));this.jobs.set(key,structuredClone(job));},
        link:async id=>structuredClone(this.links.get(this.key(scope,id))??null),
        saveLink:async(link,version)=>{fault('link');const key=this.key(scope,link.orderId);if(link.requestReference&&[...this.links.entries()].some(([otherKey,other])=>otherKey!==key&&adaptationNamespace(other.scope)===adaptationNamespace(scope)&&other.requestReference===link.requestReference))throw new AdaptationError('CONFLICT');cas(version,this.links.get(key));this.links.set(key,structuredClone(link));},
        appendTrace:async trace=>{fault('trace');this.traces.push(structuredClone(trace));},
      });fault('commit');return {value:structuredClone(result),assurance:'SIMULATED'};
    }catch(error){this.jobs=saved.jobs;this.links=saved.links;this.traces=saved.traces;throw error;}finally{unlock();}
  }
}
