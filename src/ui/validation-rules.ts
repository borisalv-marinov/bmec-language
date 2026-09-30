export const validationRules = ['nonempty','email','number','date','datetime','url'] as const;
export const validationRuleAliases = {required:'nonempty',numeric:'number','iso-date':'date','iso-datetime':'datetime','http-url':'url'} as const;

export type ValidationRule = typeof validationRules[number];
