var fs = require('fs');

module.exports = function (options, next) {
  try {
    options.template = JSON.parse(fs.readFileSync(options.project));
    next();
  }
  catch (err) {
    next(err);
  }

};