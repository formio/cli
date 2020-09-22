'use strict';

module.exports = function(program, next) {
  return {
    bootstrap: require('./bootstrap.js')(program, next),
    clone: require('./clone.js')(program, next),
    deploy: require('./deploy.js')(program, next),
    serve: require('./serve.js')(program, next),
    bind: require('./bind.js')(program, next),
    copy: require('./copy.js')(program, next),
    migrate: require('./migrate.js')(program, next),
    submissions: require('./submissions.js')(program, next)
  };
};
