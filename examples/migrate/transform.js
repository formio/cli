var header = true;
module.exports = function(record, next) {
  if (header) {
    // Ignore the header row.
    header = false;
    return next();
  }
  next(null, {
    data: {
      firstName: record[0],
      lastName: record[1],
      email: record[2]
    }
  });
};
