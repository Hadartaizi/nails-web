const express = require('express');
const cors = require('cors');
require('./config/db');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/appointments', require('./routes/appointments'));

app.listen(3000, () => console.log('Server running'));
