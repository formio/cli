'use strict';
const fetch = require("./fetch");

module.exports = function(options, next) {
  console.log('Exporting Template');
  fetch(options)({
    url: `${options.project}/export`
  }).then(({ body }) => {
    options.template = body
    if (
      !process.env.TEST_SUITE &&
      body.plan &&
      (body.plan === 'basic' || body.plan === 'archived')
    ) {
      return next('Deploy is only available for projects on a paid plan.');
    }
    next();
  }).catch(next)
};
