import {Buffer} from 'node:buffer';

export interface MultipartFile {
  fieldName:string;
  filename:string;
  mediaType:string;
  size:number;
  data:Buffer;
}

export interface MultipartForm {
  fields:Record<string,string[]>;
  files:MultipartFile[];
}

const multipartError=(code:string,message:string):never=>{throw new Error(`${code}: ${message}`)};

function boundaryFrom(contentType:string):string {
  const match=/^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary=match?.[1]??match?.[2];
  if(!boundary||boundary.length>200)return multipartError('PIPE-MULTIPART-001','multipart boundary is missing or invalid');
  return boundary;
}

function safeFilename(value:string):string {
  const basename=value.replace(/\\/g,'/').split('/').pop()??'';
  const cleaned=basename.replace(/[\u0000-\u001f\u007f]/g,'').trim();
  if(!cleaned||cleaned==='.'||cleaned==='..')return 'upload.bin';
  return cleaned.slice(0,255);
}

function headersFrom(raw:Buffer):Map<string,string> {
  const headers=new Map<string,string>();
  for(const line of raw.toString('utf8').split('\r\n')){
    const separator=line.indexOf(':');
    if(separator<=0)continue;
    headers.set(line.slice(0,separator).trim().toLowerCase(),line.slice(separator+1).trim());
  }
  return headers;
}

function disposition(value:string|undefined):{name:string;filename?:string} {
  if(!value||!/^form-data\s*;/i.test(value))return multipartError('PIPE-MULTIPART-002','content disposition must be form-data');
  const name=/\bname="([^"]+)"/i.exec(value)?.[1]??/\bname=([^;\s]+)/i.exec(value)?.[1];
  if(!name)return multipartError('PIPE-MULTIPART-002','multipart field name is missing');
  const filename=/\bfilename="([^"]*)"/i.exec(value)?.[1]??/\bfilename=([^;\s]+)/i.exec(value)?.[1];
  return {name,filename};
}

/** Parse a bounded multipart/form-data body at the Node transport boundary.
 * Raw bytes never enter BMEC JSON or browser projections. */
export function parseMultipart(body:Uint8Array,contentType:string,options:{maxParts?:number;maxFileBytes?:number}={}):MultipartForm {
  const bytes=Buffer.from(body),boundary=Buffer.from(`--${boundaryFrom(contentType)}`),maxParts=options.maxParts??100,maxFileBytes=options.maxFileBytes??10_000_000;
  if(!Number.isSafeInteger(maxParts)||maxParts<=0||!Number.isSafeInteger(maxFileBytes)||maxFileBytes<=0)return multipartError('PIPE-MULTIPART-003','multipart limits are invalid');
  const fields:Record<string,string[]>={},files:MultipartFile[]=[];let cursor=bytes.indexOf(boundary),parts=0;
  if(cursor<0)return multipartError('PIPE-MULTIPART-004','multipart boundary was not found');
  while(cursor>=0){
    cursor+=boundary.length;
    if(bytes.subarray(cursor,cursor+2).toString('ascii')==='--')break;
    if(bytes.subarray(cursor,cursor+2).toString('ascii')!=='\r\n')return multipartError('PIPE-MULTIPART-004','multipart delimiter is malformed');
    const headerStart=cursor+2,headerEnd=bytes.indexOf(Buffer.from('\r\n\r\n'),headerStart);
    if(headerEnd<0)return multipartError('PIPE-MULTIPART-004','multipart headers are incomplete');
    const next=bytes.indexOf(boundary,headerEnd+4);if(next<0)return multipartError('PIPE-MULTIPART-004','multipart closing boundary is missing');
    const payloadEnd=next-2;if(payloadEnd<headerEnd+4)return multipartError('PIPE-MULTIPART-004','multipart payload is malformed');
    if(++parts>maxParts)return multipartError('PIPE-MULTIPART-005','multipart part count exceeds limit');
    const info=disposition(headersFrom(bytes.subarray(headerStart,headerEnd)).get('content-disposition'));
    const payload=bytes.subarray(headerEnd+4,payloadEnd),mediaType=headersFrom(bytes.subarray(headerStart,headerEnd)).get('content-type')??'text/plain';
    if(info.filename!==undefined){if(payload.length>maxFileBytes)return multipartError('PIPE-MULTIPART-006','multipart file exceeds size limit');files.push({fieldName:info.name,filename:safeFilename(info.filename),mediaType,size:payload.length,data:Buffer.from(payload)});}
    else (fields[info.name]??=[]).push(payload.toString('utf8'));
    cursor=next;
  }
  return {fields,files};
}
