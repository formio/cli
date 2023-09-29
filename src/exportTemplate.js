'use strict';
const fetch = require('./fetch');

module.exports = function(options, next) {
  console.log('Exporting Template');
  fetch(options)({
    url: `${options.project}`
  }).then(({body})=> {
    if (body.plan && (body.plan === 'basic' || body.plan === 'archived')
    ) {
      return next('Deploy is only available for projects on a paid plan.');
    }
    return fetch(options)({
      url: `${options.project}/export`});
  }).then(({body}) => {
    options.template = body;
    options.template = body;

    next();
  }).catch(next);
};
