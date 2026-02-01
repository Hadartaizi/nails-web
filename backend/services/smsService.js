const twilio = require('twilio');

const client = twilio(
  'TWILIO_SID',
  'TWILIO_AUTH'
);

exports.sendSMS = (to, text) => {
  return client.messages.create({
    body: text,
    from: '+123456789',
    to
  });
};
