import {describe,it,expect} from 'vitest';
import {parse,PipeParseError} from '../src/parser/parser.js';
import {PipeLexError} from '../src/lexer/lexer.js';

describe('malformed input robustness',()=>{it('does not hang or throw uncontrolled errors for deterministic malformed inputs',()=>{const alphabet='{}()=+-*/<>!@#$%^&;\n abc123';for(let seed=0;seed<150;seed++){let s='';for(let i=0;i<24;i++)s+=alphabet[(seed*17+i*31)%alphabet.length];try{parse(s,`fuzz-${seed}.pipe`)}catch(e){expect(e instanceof PipeParseError||e instanceof PipeLexError).toBe(true)}}})});
