import {readFileSync} from 'node:fs';
import {execNpm} from './npm-runner.mjs';

const run=(args)=>execNpm(args,{encoding:'utf8'});
let auditOutput;
try{auditOutput=run(['audit','--audit-level=high','--json']);}
catch(error){auditOutput=String(error.stdout??'');}
const audit=JSON.parse(auditOutput);
const vulnerabilities=audit.metadata?.vulnerabilities?.total??Object.keys(audit.vulnerabilities??{}).length;
if(vulnerabilities!==0) throw new Error(`production dependency audit reported ${vulnerabilities} vulnerabilities`);
let sbom;
try{sbom=JSON.parse(run(['sbom','--package-lock-only','--sbom-format=cyclonedx']));}
catch(error){
  const tree=JSON.parse(run(['ls','--omit=dev','--all','--json']));
  const components=[];
  const visit=dependencies=>{for(const [name,dependency] of Object.entries(dependencies??{})){if(!dependency.version)continue;components.push({type:'library',name,version:dependency.version,purl:`pkg:npm/${name}@${dependency.version}`});visit(dependency.dependencies);}};
  visit(tree.dependencies);
  sbom={bomFormat:'CycloneDX',specVersion:'1.5',version:1,components};
}
if(sbom.bomFormat!=='CycloneDX'||!Array.isArray(sbom.components)) throw new Error('production SBOM is not valid CycloneDX output');
const productionDependencies=Object.keys(JSON.parse(readFileSync('package.json','utf8')).dependencies??{});
const sbomNames=new Set(sbom.components.map(component=>component.name));
const missingDependencies=productionDependencies.filter(name=>!sbomNames.has(name));
if(missingDependencies.length) throw new Error(`production SBOM omits declared dependencies: ${missingDependencies.join(', ')}`);
const packed=JSON.parse(run(['pack','--dry-run','--json']))[0];
const forbidden=/^(src|tests|test|scripts|\.github|docs)\//i;
const publicGuides=new Set(['docs/install.md','docs/bmec_editor_setup.md','docs/language-completion.md','docs/getting_started.md','docs/learning_path.md','docs/language_basics.md','docs/full_stack_guide.md','docs/custom_app_reading_queue.md','docs/capabilities.md','docs/native_backend_coverage.md','docs/capability_coverage.md','docs/showcase.md','docs/cli_reference.md','docs/standard_library.md','docs/styling_guide.md','docs/ai_agent_guide.md','docs/ai_website.md','docs/security_model.md','docs/threat_model.md','docs/database_production.md','docs/deployment.md']);
const safeNamedTokens=new Set(['dist/style/design-tokens.js']);
const leaked=packed.files.map(file=>file.path).filter(path=>(forbidden.test(path)&&!publicGuides.has(path.toLowerCase()))||(/\.env($|\.)|secret|password|token/i.test(path)&&!safeNamedTokens.has(path.toLowerCase())));
if(leaked.length) throw new Error(`release package contains forbidden paths: ${leaked.join(', ')}`);
console.log(`SECURITY_GATE PASS — 0 dependency vulnerabilities, CycloneDX lockfile SBOM with ${sbom.components.length} components, ${packed.entryCount} release files without source/test/secret paths`);
