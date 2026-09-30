export type BMECStyleCategory='compatibility'|'theme'|'surface'|'layout'|'state'|'typography'|'spacing';
export interface BMECStyleValue {name:string;category:BMECStyleCategory}
const BMEC_STYLE_CATEGORIES:Record<string,BMECStyleCategory>={
 clean:'compatibility',light:'theme',dark:'theme',calm:'theme',contrast:'theme',
 rounded:'surface',accent:'surface',shadow:'surface',
 wide:'layout',responsive:'layout',centered:'layout',
 focus:'state',disabled:'state',
 readable:'typography',comfortable:'spacing'
};
export const BMEC_STYLE_VALUES = new Set(Object.keys(BMEC_STYLE_CATEGORIES));
export function typedStyleValue(name:string):BMECStyleValue|undefined{const category=BMEC_STYLE_CATEGORIES[name];return category?{name,category}:undefined}
