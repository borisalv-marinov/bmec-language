import {fileURLToPath} from 'node:url';

/** Resolve file document URIs without losing Windows drive letters or spaces. */
export function filePathFromDocumentUri(uri:string):string {
  try {
    const parsed=new URL(uri);
    return parsed.protocol==='file:'?fileURLToPath(parsed):uri;
  } catch {
    return uri;
  }
}
