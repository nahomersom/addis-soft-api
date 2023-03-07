
require('dotenv').config();
const routes = require('./routes/routes');
const express = require('express');
const cors = require('cors')
const mongoose = require('mongoose');
const app = express();
app.use(express.json());
app.use(cors())
//storing the connection string
const mongoString = process.env.DATABASE_URL;

mongoose.connect(mongoString);
const database = mongoose.connection;

database.on('error', (error) => {
    console.log(error)
})

database.once('connected', () => {
    console.log('Database Connected');
})





//base endpoint and the contents of the routes
app.use('/api', routes)
const port = process.env.PORT || 8000
app.listen(port, () => {
    console.log(`Server Started at ${port}`)
})