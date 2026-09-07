export type DynamicElementType = string | ((props: Record<string, unknown>) => any) | (string & {});

export type DynamicProps<T extends DynamicElementType = DynamicElementType> = {
	is: T | null | undefined | false;
	[key: string]: unknown;
};

/** Type-only helper used by TSRX's Volar output for dynamic tags. */
export declare function Dynamic<T extends DynamicElementType>(props: DynamicProps<T>): any;
