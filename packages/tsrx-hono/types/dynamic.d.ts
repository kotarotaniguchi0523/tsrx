import type { FC, JSXNode } from 'hono/jsx';

export type DynamicElementType = string | FC;

export type DynamicProps<T extends DynamicElementType = DynamicElementType> = {
	is: T | null | undefined | false;
	[key: string]: unknown;
};

/** Type-only helper used by TSRX's Volar output for dynamic tags. */
export declare function Dynamic<T extends DynamicElementType>(props: DynamicProps<T>): JSXNode;
