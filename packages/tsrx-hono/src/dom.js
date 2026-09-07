import { createCompiler } from './compiler.js';
import { hono_dom_transform } from './platform.js';

const compiler = createCompiler(hono_dom_transform);

export const { parse, compile, compile_to_volar_mappings } = compiler;
export { isRefProp } from './ref.js';
