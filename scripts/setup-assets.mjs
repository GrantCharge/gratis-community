import {mkdir,readFile,writeFile,rename,rm,copyFile,readdir,access,constants} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
async function download(url,file,sha){try{if(createHash('sha256').update(await readFile(file)).digest('hex')===sha)return;}catch{}
 const response=await fetch(url,{signal:AbortSignal.timeout(300000)});if(!response.ok)throw new Error(`Download failed (${response.status}): ${url}`);const data=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(data).digest('hex')!==sha)throw new Error('Download checksum mismatch. No asset installed.');await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.part',data,{mode:0o600});await rename(file+'.part',file);}
const manifest=JSON.parse(await readFile(path.join(root,'assets/models/manifest.json')));
for(const file of manifest.files){await download(`https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${manifest.revision}/${file.path}`,path.join(root,'assets/models/sentence-encoder',file.path),file.sha256);console.log('Verified model asset:',file.path);}
for(const name of ['LICENSE','NOTICE'])await copyFile(path.join(root,'licenses','sentence-encoder-'+name),path.join(root,'assets/models/sentence-encoder',name));
if(process.platform==='darwin'&&['arm64','x64'].includes(process.arch)){
 const arch=process.arch==='arm64'?'aarch64':'x64',sha=arch==='aarch64'?'c785c9ba4564341c78b22b2859cabe862c646bc2b8f8954fa46796b8b721a678':'4fc736496ffe880315a751179d1c8e8a7ae19650966de314dce1e7fd1241b2d5';
 const zip=path.join(root,'.cache',`composio-${arch}.zip`);await download(`https://github.com/ComposioHQ/composio/releases/download/%40composio%2Fcli%400.6.0/composio-darwin-${arch}.zip`,zip,sha);
 const entries=execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');if(entries.some(x=>x.startsWith('/')||x.split('/').includes('..')))throw new Error('Unsafe archive path.');
 const staging=path.join(root,'.cache','composio-'+randomUUID());await mkdir(staging,{recursive:true});execFileSync('unzip',['-q',zip,'-d',staging]);
 // Composio's archive wraps the client in one top-level folder (composio-darwin-<arch>/); Gratis expects composio-cli/composio.
 const top=await readdir(staging,{withFileTypes:true}),source=top.length===1&&top[0].isDirectory()?path.join(staging,top[0].name):staging;
 await access(path.join(source,'composio'),constants.X_OK);
 const destination=path.join(root,'assets/composio-cli');await rm(destination,{recursive:true,force:true});await rename(source,destination);if(source!==staging)await rm(staging,{recursive:true,force:true});console.log('Verified Composio CLI installed.');
}else console.log('Composio browser sign-in packaging is currently supported on macOS. API-key setup is available in Settings.');
