import {describe,expect,it} from 'vitest';
import {render} from '../src/ui/dom.js';
import {primitive} from '../src/types/type-ref.js';

describe('direct DOM accessibility projection',()=>{
  it('projects validation state to aria attributes',()=>{
    const make=(tag:string)=>{const node:any={tag,children:[],dataset:{},attributes:{},listeners:{},appendChild(child:any){this.children.push(child)},addEventListener(name:string,handler:(event:any)=>void){this.listeners[name]=handler},setAttribute(name:string,value:string){this.attributes[name]=value}};return node};
    (globalThis as any).document={createTextNode:(value:string)=>({tag:'text',value}),createElement:make,createDocumentFragment:()=>make('fragment')};
    const root:any={children:[],replaceChildren(){this.children=[]},appendChild(node:any){this.children.push(node)}};
    render({components:[{id:'C1',name:'Form',props:[],state:[],events:[{name:'changed',parameters:{value:primitive('text')}}],children:[{kind:'input',name:'title',type:primitive('text'),validation:'nonempty',event:'changed'}]}],routes:[]},root,{},'/',{changed:()=>{}});
    const input=root.children[0];
    expect(input.attributes).toMatchObject({'aria-label':'title','aria-invalid':'false','aria-required':'true'});
    input.value='';input.listeners.input({target:input});expect(input.attributes['aria-invalid']).toBe('true');
    input.value='Ready';input.listeners.input({target:input});expect(input.attributes['aria-invalid']).toBe('false');
  });
  it('validates inputs even without an event handler',()=>{
    const make=(tag:string)=>{const node:any={tag,children:[],dataset:{},attributes:{},listeners:{},appendChild(child:any){this.children.push(child)},addEventListener(name:string,handler:(event:any)=>void){this.listeners[name]=handler},setAttribute(name:string,value:string){this.attributes[name]=value}};return node};
    (globalThis as any).document={createTextNode:(value:string)=>({tag:'text',value}),createElement:make,createDocumentFragment:()=>make('fragment')};
    const root:any={children:[],replaceChildren(){this.children=[]},appendChild(node:any){this.children.push(node)}};
    render({components:[{id:'C1',name:'Form',props:[],state:[],events:[],children:[{kind:'input',name:'title',type:primitive('text'),validation:'nonempty'}]}],routes:[]},root);
    const input=root.children[0];input.value='';input.listeners.input({target:input});expect(input.attributes['aria-invalid']).toBe('true');
  });
  it('projects source input hints without replacing the accessible name',()=>{
    const make=(tag:string)=>{const node:any={tag,children:[],dataset:{},attributes:{},listeners:{},appendChild(child:any){this.children.push(child)},addEventListener(name:string,handler:(event:any)=>void){this.listeners[name]=handler},setAttribute(name:string,value:string){this.attributes[name]=value}};return node};
    (globalThis as any).document={createTextNode:(value:string)=>({tag:'text',value}),createElement:make,createDocumentFragment:()=>make('fragment')};
    const root:any={children:[],replaceChildren(){this.children=[]},appendChild(node:any){this.children.push(node)}};
    render({components:[{id:'C1',name:'Form',props:[],state:[],events:[],children:[{kind:'input',name:'title',label:'Title',placeholder:'Short title',help:'Keep it concise',disabled:true,readOnly:true,type:primitive('text')}]}],routes:[]},root);
    expect(root.children[0].attributes).toMatchObject({'aria-label':'Title','placeholder':'Short title','aria-description':'Keep it concise',disabled:'true','aria-disabled':'true',readonly:'true','aria-readonly':'true'});
  });
  it('uses semantic email and password input modes in the direct renderer',()=>{
    const make=()=>({children:[] as any[],replaceChildren(...nodes:any[]){this.children=nodes},appendChild(node:any){this.children.push(node)}} as any);
    const root=make();
    render({components:[{id:'C1',name:'Login',props:[],state:[],events:[],children:[{kind:'input',name:'email',type:primitive('text'),validation:'email'},{kind:'input',name:'secret',type:primitive('text'),password:true}]}],routes:[]},root);
    expect(root.children.map((child:any)=>child.attributes.type)).toEqual(['email','password']);
  });
});
