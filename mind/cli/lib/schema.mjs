// A small JSON Schema check for what th sends: the subset scripts/contract.mjs emits from the
// contract's zod/mini schemas (type, properties, required, additionalProperties, enum, const,
// string length and pattern, number bounds, items, anyOf). The Worker validates again; this is
// so the mind hears about a bad call at once (exit 8), with the path that is wrong.

/**
 * @param {any} value
 * @param {Record<string, any>} schema
 * @param {string} [path]
 * @returns {string|null} the first problem, or null
 */
export function check(value, schema, path = '') {
  const at = path || '(value)';
  if (!schema || typeof schema !== 'object') return null;
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some(s => check(value, s, path) === null) ? null : `${at}: matches none of the allowed shapes`;
  }
  if ('const' in schema && value !== schema.const) return `${at}: must be ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${at}: must be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`;
  const type = schema.type;
  if (type && !typeOk(value, type)) return `${at}: must be ${Array.isArray(type) ? type.join(' or ') : type}`;
  if (typeof value === 'string') {
    // UTF-16 length, as the Worker's zod checks count it.
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${at}: at least ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${at}: at most ${schema.maxLength} characters`;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return `${at}: does not match ${schema.pattern}`;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${at}: at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${at}: at most ${schema.maximum}`;
  }
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const p = check(value[i], schema.items, `${path}[${i}]`);
      if (p) return p;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {};
    for (const key of schema.required || []) if (!(key in value)) return `${path ? `${path}.` : ''}${key}: required`;
    for (const [key, v] of Object.entries(value)) {
      const sub = `${path ? `${path}.` : ''}${key}`;
      if (key in props) {
        const p = check(v, props[key], sub);
        if (p) return p;
      } else if (schema.additionalProperties === false) return `${sub}: not a known field`;
    }
  }
  return null;
}

function typeOk(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some(t =>
    t === 'null' ? value === null
      : t === 'array' ? Array.isArray(value)
        : t === 'integer' ? Number.isInteger(value)
          : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
            : typeof value === t);
}
