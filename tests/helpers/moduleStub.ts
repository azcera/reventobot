import Module = require('node:module')

/** A complete Node cache entry, so test doubles retain real require-cache semantics. */
export function moduleStub(entry: Pick<NodeModule, 'id' | 'filename' | 'loaded' | 'exports'>): NodeModule {
 return Object.assign(new Module(entry.id), entry)
}

/** Isolate the deliberate structural gap between a focused test double and a library object. */
export function asMock<T>(value: unknown): T { return value as T }
