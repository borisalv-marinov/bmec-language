import type {DbPredicate} from './ir.js';

export type PredicateExpression<T> = {kind:'and'|'or';items:PredicateExpression<T>[]} |
  {kind:'compare';field:string;operator:Extract<DbPredicate,{kind:'compare'}>['operator'];value:T};
export type PredicateExpressionToken<T> = '('|')'|'and'|'or'|Extract<PredicateExpression<T>,{kind:'compare'}>;

/** Parse a typed predicate token stream using conventional AND-before-OR
 * precedence; parentheses can be used to make the intended grouping explicit. */
export function parsePredicateExpression<T>(tokens:readonly PredicateExpressionToken<T>[]):PredicateExpression<T>{
 let position=0,depth=0;
 const primary=():PredicateExpression<T>=>{
  const token=tokens[position++];
  if(token==='('){if(++depth>64)throw new Error('Database predicate nesting exceeds 64 groups');const value=or();if(tokens[position++]!==')')throw new Error('Database predicate group is missing a closing parenthesis');depth--;return value;}
  if(token&&typeof token==='object'&&token.kind==='compare')return token;
  throw new Error('Database predicate expected a comparison or parenthesized group');
 };
 const and=():PredicateExpression<T>=>{const items=[primary()];while(tokens[position]==='and'){position++;items.push(primary());}return items.length===1?items[0]!: {kind:'and',items};};
 const or=():PredicateExpression<T>=>{const items=[and()];while(tokens[position]==='or'){position++;items.push(and());}return items.length===1?items[0]!: {kind:'or',items};};
 const expression=or();if(position!==tokens.length)throw new Error('Unexpected token in database predicate expression');return expression;
}

export function collectPredicateComparisons<T>(expression:PredicateExpression<T>):Extract<PredicateExpression<T>,{kind:'compare'}>[] {
 return expression.kind==='compare'?[expression]:expression.items.flatMap(collectPredicateComparisons);
}
