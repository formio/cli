var header = true;
module.exports = function(record, next) {
  if (header) {
    // Ignore the header row.
    header = false;
    return next();
  }
  next(null, {
    data: {
      firstName: record[0].trim(),
      lastName: record[1].trim(),
      email: record[2].trim()
    }
  });
};
