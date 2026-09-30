import type {RuntimeHandle} from './server.js';

export interface ShutdownSignalSource {
  on(event:'SIGINT'|'SIGTERM',listener:()=>void):unknown;
  removeListener(event:'SIGINT'|'SIGTERM',listener:()=>void):unknown;
}

/** Drain HTTP work and close runtime resources once after the first shutdown signal. */
export function installGracefulShutdown(handle:Pick<RuntimeHandle,'close'>,signals:ShutdownSignalSource,onError:(error:unknown)=>void=()=>{}):()=>void {
  let closing=false;
  const stop=()=>{
    if(closing)return;
    closing=true;
    void handle.close().catch(onError).finally(()=>{
      signals.removeListener('SIGINT',stop);
      signals.removeListener('SIGTERM',stop);
    });
  };
  signals.on('SIGINT',stop);
  signals.on('SIGTERM',stop);
  return ()=>{
    signals.removeListener('SIGINT',stop);
    signals.removeListener('SIGTERM',stop);
  };
}
