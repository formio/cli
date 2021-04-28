'use strict';

module.exports = function(program, next) {
  return {
    clone: require('./clone.js')(program, next),
    deploy: require('./deploy.js')(program, next),
    copy: require('./copy.js')(program, next),
    migrate: require('./migrate.js')(program, next),
    submissions: require('./submissions.js')(program, next)
  };
};
