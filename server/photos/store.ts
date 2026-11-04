/**
 * The slice of Cloudflare's R2Bucket the app uses, so tests can pass an in-memory bucket.
 * Keys are `<businessId>/<customerId>/<photoId>`; nothing in a key is guessable from outside,
 * and every read goes through the visit_photos row (row-level security) first.
 */
export interface PhotoBucket {
	put(key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
	get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
	delete(key: string): Promise<void>;
}

export function memoryBucket(): PhotoBucket & { keys(): string[] } {
	const m = new Map<string, { data: ArrayBuffer; type?: string }>();
	return {
		async put(key, value, options) {
			const data = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer();
			m.set(key, { data, type: options?.httpMetadata?.contentType });
		},
		async get(key) {
			const v = m.get(key);
			return v ? { body: new Response(v.data).body!, httpMetadata: { contentType: v.type } } : null;
		},
		async delete(key) {
			m.delete(key);
		},
		keys: () => [...m.keys()],
	};
}
