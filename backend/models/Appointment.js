const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  date: String,
  hour: String,
  phone: String,
  status: { type: String, default: 'booked' } // booked / waiting
});

module.exports = mongoose.model('Appointment', schema);
