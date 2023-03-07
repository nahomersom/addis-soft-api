const mongoose = require('mongoose');

const dataSchema = new mongoose.Schema({
    title: {
        required: true,
        type: String
    },
    artist: {
        required: true,
        type: String
    },
    album: {
        required: false,
        type: String
    },
    genre: {
        required: true,
        type: String
    }
},

)

module.exports = mongoose.model('songs', dataSchema)