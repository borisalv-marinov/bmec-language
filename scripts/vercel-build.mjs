import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';

const root=process.cwd();
const npmCli=process.env.npm_execpath;
if(!npmCli||!existsSync(npmCli))throw new Error('Run the Vercel build through npm so its npm executable is available');
const runNpm=(args,cwd=root)=>execFileSync(process.execPath,[npmCli,...args],{cwd,stdio:'inherit',env:process.env});
const rootPackage=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const extensionPackage=JSON.parse(readFileSync(join(root,'vscode-extension','package.json'),'utf8'));
const artifactDirectory=resolve(root,'.tmp','release-artifacts');
const packageArchive=join(artifactDirectory,`${rootPackage.name.replace(/^@/,'').replace('/','-')}-${rootPackage.version}.tgz`);
const vsixArchive=join(artifactDirectory,`bmec-language-support-${extensionPackage.version}.vsix`);

rmSync(artifactDirectory,{recursive:true,force:true});
mkdirSync(artifactDirectory,{recursive:true});
runNpm(['run','build']);
runNpm(['pack','--pack-destination',artifactDirectory]);
runNpm(['ci','--prefix','vscode-extension']);
runNpm(['exec','--yes','--package','@vscode/vsce@4.0.0','--','vsce','package','--pre-release','--out',vsixArchive],join(root,'vscode-extension'));

if(!existsSync(packageArchive)||!existsSync(vsixArchive))throw new Error('The exact npm and VS Code release archives were not produced');
process.env.BMEC_PACKAGE_ARCHIVE=packageArchive;
process.env.BMEC_VSIX_ARCHIVE=vsixArchive;
execFileSync(process.execPath,[join(root,'scripts','build-website.mjs')],{cwd:root,stdio:'inherit',env:process.env});
