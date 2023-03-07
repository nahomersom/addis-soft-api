const express = require('express');
const SongModel = require('../models/song-model');
const { validateSong } = require("../validation/song-validation");
const router = express.Router();
module.exports = router;



//add New Song
router.post('/songs/add', async (req, res) => {

    const { error, value } = validateSong(req.body);
    if(!error){
      try {
        const data = new SongModel(req.body);
            const dataToSave = await data.save()
            res.send({message:'new song added successfully'})
        }
        catch (error) {
            res.send({message: error.message});
        }
    }else{
        res.send({message:'invalid data sent'});
    }
})

//Get all Songs
router.get('/songs/getAll',async (req, res) => {
    try{
        const songs = await SongModel.find();
        
        res.json(songs)
    }
    catch(error){
        res.send({message: error.message})
    }
})

//Get Single Song by ID
router.get('/songs/getOne/:id', async (req, res) => {
    try{
        const data = await SongModel.findById(req.params.id);
        res.json(data)
    }
    catch(error){
        res.send({message: error.message})
    }
})

//Update Song by ID 
router.patch('/songs/update/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const updatedData = req.body;
        const options = { new: true };

        const result = await SongModel.findByIdAndUpdate(
            id, updatedData, options
        )

        res.send({message:'song updated successfully'})
    }
    catch (error) {
        res.send({ message: error.message })
    }
})

//Delete a Song
router.delete('/songs/delete/:id',async (req, res) => {
    try {
        const id = req.params.id;
        const data = await SongModel.findByIdAndDelete(id)
        res.send({message:`Song with the artist name ${data.artist} has been deleted..`})
    }
    catch (error) {
        res.send({message:error.message})
    }
})
//Count Songs based on conditions
router.get('/songs/statistics',async (req, res) => {
    try{
        const songs = await SongModel.find().countDocuments()
        const artist = await SongModel.distinct('artist');
        const albums = await SongModel.distinct('album');
        const genre = await SongModel.distinct('genre');
        const songs_per_genre = await SongModel.aggregate([
            {
                $group:{
                    _id:"$genre",
                    songs:{$sum: 1}
                }
            }
        ])
        const songs_per_album = await SongModel.aggregate([
            {
                $group:{
                    _id:"$album",
                    songs:{$sum: 1}
                }
            }
        ])
        const songs_per_artist = await SongModel.aggregate([
            {
                $group:{
                    _id:"$artist",
                    
                    songs:{$sum: 1}
                }
            }
        ]);
        const albums_per_artist = await SongModel.aggregate([
            {
                $group: {
                    _id: {
                      artist: "$artist"
                    }
                  }
                },
                {
                  $group: {
                    _id: "$_id.artist",
                    "album": { $sum: 1 }
                  }
                
            }
        ]);
    
        res.json({
            songs: songs,
            artists:artist.length,
            albums: albums.length,
            genre: genre.length,
            songs_per_genre:songs_per_genre,
            songs_per_album:songs_per_album,
            songs_per_artist:songs_per_artist,
            albums_per_artist:albums_per_artist
        }
            )
    }
    catch(error){
        res.send({message: error.message})
    }
})