import type {TypeRef} from '../types/type-ref.js';
export function validateInput(value:unknown,type:TypeRef,rule?:string):string|undefined{
 if(type.kind==='optional'){if(value===undefined||value===null||value==='')return undefined;return validateInput(value,type.inner,rule)}
 if(rule==='nonempty'&&(typeof value!=='string'||value.trim().length===0))return 'value is required';
 if(rule==='email'&&(typeof value!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())))return 'expected email';
 if(rule==='url'&&(typeof value!=='string'||!isHttpUrl(value.trim())))return 'expected http(s) URL';
 if(rule==='number'&&(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&value.trim()===''||!Number.isFinite(typeof value==='number'?value:Number(value))))return 'expected finite number';
 if(rule==='date'&&(typeof value!=='string'||!isIsoDate(value.trim())))return 'expected ISO date';
 if(rule==='datetime'&&(typeof value!=='string'||!isIsoDatetime(value.trim())))return 'expected ISO datetime';
 if(type.kind!=='primitive')return undefined;
 if(type.name==='text')return typeof value==='string'?undefined:'expected text';
 if(type.name==='boolean')return typeof value==='boolean'||value==='true'||value==='false'?undefined:'expected boolean';
 if(type.name==='integer')return typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^-?(0|[1-9]\d*)$/.test(value)?undefined:'expected int64 integer';
 if(type.name==='number')return typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&Number.isFinite(Number(value))?undefined:'expected finite number';
 if(type.name==='money')return typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^-?\d+(?:\.\d{1,2})?$/.test(value)?undefined:'expected exact money';
 if(type.name==='date')return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?undefined:'expected date';
 if(type.name==='datetime')return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)?undefined:'expected datetime';
 return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)?undefined:'expected id';
}
function isHttpUrl(value:string):boolean{try{const parsed=new URL(value);return parsed.protocol==='http:'||parsed.protocol==='https:'}catch{return false}}
function isIsoDate(value:string):boolean{const parts=value.split('-');if(parts.length!==3||parts.some(part=>!/^[0-9]+$/.test(part)))return false;const [year,month,day]=parts.map(Number);if(year<1||month<1||month>12||day<1)return false;const date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day}
function isIsoDatetime(value:string):boolean{const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/);if(!match)return false;const [year,month,day,hour,minute,second]=match.slice(1).map(Number);if(hour>23||minute>59||second>59)return false;const date=new Date(Date.UTC(year,month-1,day,hour,minute,second));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day&&date.getUTCHours()===hour&&date.getUTCMinutes()===minute&&date.getUTCSeconds()===second}
