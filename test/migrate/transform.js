
'use strict';
let header = true;
module.exports = function(record, next) {
  if (header) {
    // Ignore the header row.
    header = false;
    return next();
  }
  next(null, {
    data: {
      textField: record[0],
      secondField: record[1],
      thirdField: record[2]
    }
  });
};
