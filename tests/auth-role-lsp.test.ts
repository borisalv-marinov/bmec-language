import {describe,expect,it} from 'vitest';
import {createLanguageService} from '../src/lsp/service.js';

describe('controlled-English authorization completion',()=>{
  it('offers role after a route requires clause',()=>{
    const service=createLanguageService(),uri='file:///auth-role.bmec',text='app Secure\nserve GET /private requiring ';
    service.open({uri,file:'auth-role.bmec',text});
    expect(service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label)).toContain('role');
  });
  it('offers typed capabilities after a controlled-English requiring clause',()=>{
    const service=createLanguageService(),uri='file:///auth-capability.bmec',text='app Secure\nserve GET /health requiring ';
    service.open({uri,file:'auth-capability.bmec',text});
    expect(service.completion(uri,{line:1,character:text.split('\n')[1]!.length}).map(item=>item.label)).toEqual(expect.arrayContaining(['database','environment','time','random','secureRandom','filesystem']));
  });
});
