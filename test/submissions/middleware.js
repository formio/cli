// middleware.js
'use strict';

const middlewareFunc = (record, index, options, nextFunction) => {
  if (nextFunction) {
    nextFunction(null, record);
  }
};

module.exports = middlewareFunc;
