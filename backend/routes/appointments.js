const router = require('express').Router();
const Appointment = require('../models/Appointment');
const { sendSMS } = require('../services/smsService');

router.post('/', async (req, res) => {
  const { date, hour, phone } = req.body;

  const exists = await Appointment.findOne({ date, hour, status: 'booked' });

  if (exists) {
    await Appointment.create({ date, hour, phone, status: 'waiting' });
    sendSMS(phone, 'נכנסת לרשימת המתנה 💅');
  } else {
    await Appointment.create({ date, hour, phone });
    sendSMS(phone, `התור שלך נקבע ל־${date} בשעה ${hour}`);
  }

  res.sendStatus(200);
});

module.exports = router;
