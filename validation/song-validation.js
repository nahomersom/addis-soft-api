const joi = require("joi");
const {songSchema} = require('./schemas/songSchema');
const validator = (schema) => (payload) =>
  schema.validate(payload, { abortEarly: false });
exports.validateSong = validator(songSchema);