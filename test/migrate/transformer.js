var header = true;
module.exports = function(record, next) {
  if (header) {
    // Ignore the header row.
    header = false;
    return next();
  }
  next(null, {
    data: {
      firstName: record[3],
      lastName: record[4],
      email: record[5]
    }
  });
};