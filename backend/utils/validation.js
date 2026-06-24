const mongoose = require('mongoose');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const isNonEmptyString = (value) => normalizeString(value).length > 0;

const isValidBase64 = (value) => {
  if (typeof value !== 'string' || value.length === 0) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
};

module.exports = {
  isValidObjectId,
  normalizeString,
  isNonEmptyString,
  isValidBase64
};
