/**
 * This is an example of what a transform would look like.
 * @param record
 * @param next
 * @returns {*}
 */
module.exports = function(record, next) {
  return next(null, {
    data: {
      firstName: record[1],
      lastName: record[2],
      email: record[3]
    }
  });
};