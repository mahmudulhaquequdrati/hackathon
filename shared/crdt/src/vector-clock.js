/**
 * Vector Clock utilities for causal ordering.
 * A vector clock is a plain object: { [nodeId]: counter }
 */

/**
 * Create an empty vector clock
 * @returns {Object<string, number>}
 */
function create() {
  return {};
}

/**
 * Increment the clock for a given node
 * @param {Object<string, number>} clock
 * @param {string} nodeId
 * @returns {Object<string, number>}
 */
function increment(clock, nodeId) {
  return { ...clock, [nodeId]: (clock[nodeId] || 0) + 1 };
}

/**
 * Merge two vector clocks (take max of each entry)
 * @param {Object<string, number>} a
 * @param {Object<string, number>} b
 * @returns {Object<string, number>}
 */
function merge(a, b) {
  const result = { ...a };
  for (const [nodeId, count] of Object.entries(b)) {
    result[nodeId] = Math.max(result[nodeId] || 0, count);
  }
  return result;
}

/**
 * Compare two vector clocks.
 * @param {Object<string, number>} a
 * @param {Object<string, number>} b
 * @returns {'before' | 'after' | 'concurrent' | 'equal'}
 */
function compare(a, b) {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false;
  let bGreater = false;

  for (const key of allKeys) {
    const aVal = a[key] || 0;
    const bVal = b[key] || 0;
    if (aVal > bVal) aGreater = true;
    if (bVal > aVal) bGreater = true;
  }

  if (aGreater && bGreater) return 'concurrent';
  if (aGreater) return 'after';
  if (bGreater) return 'before';
  return 'equal';
}

/**
 * Check if clock a is strictly after clock b
 * @param {Object<string, number>} a
 * @param {Object<string, number>} b
 * @returns {boolean}
 */
function isAfter(a, b) {
  return compare(a, b) === 'after';
}

module.exports = { create, increment, merge, compare, isAfter };
