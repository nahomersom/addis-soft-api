const joi = require('joi');
const songSchema = joi.object({
    title: joi.string().required(),
    artist: joi.string().required(),
    album: joi.string().required(),
    genre: joi.string().required()
})
exports.songSchema = songSchema;