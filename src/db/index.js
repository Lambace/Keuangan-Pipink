'use strict';
/** Abstraksi storage: PostgreSQL (produksi) atau engine file internal (fallback/dev). */
const config = require('../config');
module.exports = function getDb() {
  return config.state.mode === 'db' ? require('./pg') : require('./file');
};
