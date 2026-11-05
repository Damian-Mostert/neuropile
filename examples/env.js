'use strict';

// Reads a NEUROPILE_* environment variable, falling back to a default.
function env(name, fallback) {
  const value = process.env[`NEUROPILE_${name}`];
  return value === undefined ? fallback : value;
}

module.exports = { env };
