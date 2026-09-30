import {describe,expect,it} from 'vitest';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compile} from '../src/compiler.js';
import {parse} from '../src/parser/parser.js';
import {toIR} from '../src/ir/ir.js';
import {generate} from '../src/generator/generate.js';
import {render} from '../src/ui/dom.js';

describe('semantic form components',()=>{
  const source='app Signup\ncomponent SignupForm form { input Email text validate email button "Save" on Save }\npage Home { use SignupForm }';

  it('parses and lowers an explicit form component through canonical UI IR',()=>{
    const ast=parse(source),component=ast.declarations.find(item=>item.kind==='ComponentDeclaration');
    expect(component).toMatchObject({kind:'ComponentDeclaration',name:'SignupForm',form:true});
    const result=compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.ui?.components).toEqual(expect.arrayContaining([expect.objectContaining({name:'SignupForm',form:true})]));
  });

  it('emits semantic form HTML while preserving typed input validation metadata',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bmec-form-'));
    generate(toIR(parse(source)),dir);
    const html=readFileSync(join(dir,'index.html'),'utf8');
    expect(html).toContain('<form data-pipe-component="COMP-001">');
    expect(html).toContain('<fieldset><legend>Signup Form</legend>');
    expect(html).toContain('<button type="button" data-pipe-event="Save">Save</button>');
    expect(html).toContain('data-pipe-validation="email"');
    expect(html).toContain('data-pipe-event="Save"');
  });

  it('uses a semantic form element in the direct-DOM renderer',()=>{
    const make=(tag:string)=>({tag,children:[] as unknown[],dataset:{} as Record<string,string>,appendChild(child:unknown){this.children.push(child)},addEventListener(){}});
    (globalThis as any).document={createTextNode:(value:string)=>({tag:'text',value}),createElement:make,createDocumentFragment:()=>make('fragment')};
    const result=compile(source),root:any={children:[],replaceChildren(){this.children=[]},appendChild(node:unknown){this.children.push(node)}};
    render(result.ir!.ui!,root);
    expect(root.children[0]?.tag).toBe('form');
  });

  it('gates named button events on typed form validation',()=>{
    const make=(tag:string):any=>{const node:any={tag,children:[] as any[],dataset:{} as Record<string,string>,listeners:{} as Record<string,(event:any)=>void>,value:'',appendChild(child:any){child.parentElement=node;node.children.push(child)},addEventListener(name:string,handler:(event:any)=>void){node.listeners[name]=handler},dispatchEvent(event:any){node.listeners[event.type]?.({type:event.type,target:node})},closest(selector:string){return selector==='form'?(node.tag==='form'?node:node.parentElement?.closest(selector)):undefined},querySelectorAll(selector:string){return selector==='[data-pipe-validation]'?node.children.flatMap((child:any)=>child.dataset?.pipeValidation?[child]:child.querySelectorAll?.(selector)??[]):[]}};return node};
    (globalThis as any).document={createTextNode:(value:string)=>({tag:'text',value}),createElement:make,createDocumentFragment:()=>make('fragment')};
    const result=compile(source),root:any={children:[],replaceChildren(){this.children=[]},appendChild(node:any){this.children.push(node)}};let saves=0;
    render(result.ir!.ui!,root,{}, '/', {Save:()=>{saves++}});
    const form=root.children[0],fieldset=form.children[0],input=fieldset.children[1],button=fieldset.children[2];
    button.listeners.click({type:'click',preventDefault(){}});expect(saves).toBe(0);expect(input.dataset.pipeError).toBe('expected email');
    input.value='ada@example.com';button.listeners.click({type:'click',preventDefault(){}});expect(saves).toBe(1);
  });

  it('passes typed repeated-row action values through the direct-DOM renderer',()=>{
    const source='app Shop\nmodel Product { sku text required }\nmodel CartLine { sku text required }\napi /cart-lines from CartLine\ncomponent ProductRow { button "Add" on add with sku from product.sku }\npage Store { event add(sku text) sends POST "/cart-lines" state products list<Product> for each product in products show ProductRow }';
    const make=(tag:string):any=>{const node:any={tag,children:[] as any[],dataset:{} as Record<string,string>,listeners:{} as Record<string,(event:any)=>void>,appendChild(child:any){node.children.push(child)},replaceChildren(...children:any[]){node.children=children},addEventListener(name:string,handler:(event:any)=>void){node.listeners[name]=handler},setAttribute(){}};return node};
    (globalThis as any).document={createTextNode:(value:string)=>({tag:'text',value}),createElement:make,createDocumentFragment:()=>make('fragment')};
    const result=compile(source),root:any={children:[],replaceChildren(){this.children=[]},appendChild(node:any){this.children.push(node)}};let submitted:any;
    render(result.ir!.ui!,root,{products:[{sku:'cup'}]},'/store',{add:(_event,value)=>{submitted=value}});
    const find=(node:any):any=>node.tag==='button'?node:node.children?.map(find).find(Boolean);
    find(root).listeners.click({type:'click'});
    expect(submitted).toEqual({sku:'cup'});
  });

  it('renders enum fields as deterministic selects in CRUD and reusable forms',()=>{
    const enumSource='app Work\nenum Status { Pending Assigned Done }\nmodel Task { status Status required }\npage Home { crud Task }\ncomponent StatusForm form { input status Status }\npage FormPage { use StatusForm }';
    const result=compile(enumSource);expect(result.diagnostics).toEqual([]);
    const dir=mkdtempSync(join(tmpdir(),'bmec-enum-select-'));generate(result.ir!,dir);const html=readFileSync(join(dir,'index.html'),'utf8');
    expect(html).toContain('<select id="pipe-crud-Home-Task-status"');
    expect(html).toContain('<option value="Pending">Pending</option><option value="Assigned">Assigned</option><option value="Done">Done</option>');
    expect(html).toContain('<select id="pipe-COMP-001-status"');
  });
});
